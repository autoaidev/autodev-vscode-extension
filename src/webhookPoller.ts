import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { VncSession } from './vnc';
import { saveAttachment } from './messageBuilder';

// ---------------------------------------------------------------------------
// WebhookPoller — mirrors PHP AutodevWebhookTaskProvider
//
// Supports two modes based on the serverBaseUrl scheme:
//
//  http:// / https://  → HTTP polling (GET /v1/logs every 3 s, ETag caching)
//  ws://  / wss://     → Persistent WebSocket connection; receives pushed frames
//
// HTTP API used:
//   GET  {baseUrl}/v1/logs?status=pending&per_page=1&endpoint_slug={slug}
//   GET  {baseUrl}/v1/logs/{id}
//   PATCH {baseUrl}/v1/logs/{id}  { status: 'received' }
//
// WebSocket: connects to ws(s)://{host}:{port}/?token={apiKey}&endpoint={slug}
//   Incoming frames are pure A2A StreamResponse JSON.
//   A task frame with status.state=TASK_STATE_SUBMITTED and metadata.event=user_message
//   causes the task text to be appended to TODO.md.
//
// Auth: X-API-Key header (HTTP) / token query param (WebSocket)
// ---------------------------------------------------------------------------

interface LogListItem {
  id: number;
}

interface A2APart {
  kind: string;
  text?: string;
  file?: { name?: string; mimeType?: string; bytes?: string; uri?: string };
}

interface LogDetail {
  id: number;
  data?: {
    payload?: {
      event?: string;
      task?: { text?: string };
      parts?: A2APart[];
    };
  };
  // Some servers embed payload directly
  payload?: {
    event?: string;
    task?: { text?: string };
    parts?: A2APart[];
  };
}

// ---------------------------------------------------------------------------
// WebSocketPoller — persistent WS connection for ws:// / wss:// endpoints
// ---------------------------------------------------------------------------

class WebSocketPoller {
  private _socket: net.Socket | null = null;
  private _connected = false;
  private _buffer = Buffer.alloc(0);
  private _todoPath = '';
  private _workspaceRoot: string | undefined;
  private _destroyed = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _log: (msg: string) => void = () => {};
  private static readonly RECONNECT_DELAY_MS = 5_000;

  private _vncPassword: string | undefined;
  private _vncSessions: Map<string, VncSession> = new Map();
  private _onConnect: (() => void) | null = null;
  private _pendingFrames: unknown[] = [];

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    private readonly slug: string,
  ) {}

  /** Called once when the WS connection is first established (and on each reconnect). */
  setOnConnect(cb: () => void): void { this._onConnect = cb; }

  /** Start the WebSocket connection (call once). */
  start(todoPath: string, log?: (msg: string) => void, workspaceRoot?: string): void {
    this._todoPath = todoPath;
    this._workspaceRoot = workspaceRoot;
    if (log) { this._log = log; }
    this._log(`WS connecting → ${this.wsUrl} (slug: ${this.slug})`);
    this._connect();
  }

  /** Tear down the connection permanently. */
  destroy(): void {
    this._destroyed = true;
    this._stopAllVncSessions();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._closeSocket();
  }

  /**
   * Called by the poller loop — always returns false because the WebSocket
   * connection is event-driven; tasks are appended directly in _onFrame().
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pollAndAppend(_todoPath: string, _workspaceRoot?: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this._destroyed) { return; }


    const parsed = new URL(this.wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    // On Windows, Node.js may resolve 'localhost' to ::1 (IPv6) but the WS server
    // only binds to 0.0.0.0 (IPv4). Force 127.0.0.1 to avoid the mismatch.
    const rawHost = parsed.hostname;
    const host = (rawHost === 'localhost' || rawHost === '::1') ? '127.0.0.1' : rawHost;
    const port = parsed.port ? parseInt(parsed.port, 10) : (isSecure ? 443 : 80);

    // Build WebSocket upgrade path: preserve any existing path, append query params
    const basePath = parsed.pathname || '/';
    const qs = new URLSearchParams({ token: this.apiKey, endpoint: this.slug }).toString();
    const upgradePath = `${basePath}?${qs}`;

    const key = crypto.randomBytes(16).toString('base64');

    const handshake = [
      `GET ${upgradePath} HTTP/1.1`,
      `Host: ${host}:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');

    const sock: net.Socket = isSecure
      ? tls.connect({ host, port, servername: host })
      : net.createConnection({ host, port });

    // For plain TCP, 'connect' is the ready signal.
    // For TLS, 'secureConnect' fires after the TLS handshake; we skip the
    // plain 'connect' event to avoid writing the HTTP upgrade too early.
    if (isSecure) {
      (sock as tls.TLSSocket).once('secureConnect', () => {
        sock.write(handshake);
      });
    } else {
      sock.once('connect', () => {
        sock.write(handshake);
      });
    }

    let headersDone = false;
    let headerBuf = '';

    sock.on('data', (chunk: Buffer) => {
      if (!headersDone) {
        headerBuf += chunk.toString('binary');
        const sep = headerBuf.indexOf('\r\n\r\n');
        if (sep === -1) { return; }

        if (!headerBuf.includes('101 Switching Protocols')) {
          const statusLine = headerBuf.split('\r\n')[0] ?? '(no response)';
          this._log(`WS upgrade rejected by ${host}:${port}: "${statusLine}" — reconnecting in ${WebSocketPoller.RECONNECT_DELAY_MS}ms`);
          sock.destroy();
          this._scheduleReconnect();
          return;
        }

        headersDone = true;
        this._connected = true;

        this._log(`WS connected → ${host}:${port} (slug: ${this.slug})`);

        // Flush any frames queued before the connection was established
        const pending = this._pendingFrames.splice(0);
        for (const frame of pending) {
          this._sendTextFrame(JSON.stringify(frame));
        }

        // Notify listener so caller can resend agent_online on reconnect
        if (this._onConnect) { this._onConnect(); }

        // Subscribe to the deliveries channel so the server pushes webhook events
        this._sendTextFrame(JSON.stringify({ type: 'subscribe', data: { channels: ['deliveries'] } }));

        // Any bytes after the headers belong to the first WS frame
        const remaining = Buffer.from(headerBuf.slice(sep + 4), 'binary');
        if (remaining.length > 0) {
          this._buffer = remaining;
          this._processBuffer();
        }
        return;
      }

      this._buffer = Buffer.concat([this._buffer, chunk]);
      this._processBuffer();
    });

    sock.on('error', (err) => {
      this._log(`WS error (${host}:${port}): ${err.message} — reconnecting in ${WebSocketPoller.RECONNECT_DELAY_MS}ms`);
      this._connected = false;
      this._scheduleReconnect();
    });

    sock.on('close', () => {
      if (this._connected) {
        this._log(`WS disconnected from ${host}:${port} — reconnecting`);
      }
      this._connected = false;
      this._scheduleReconnect();
    });

    this._socket = sock;
  }

  private _closeSocket(): void {
    if (this._socket) {
      try {
        // Send WebSocket close frame (opcode 0x8, masked, zero-length payload)
        const mask = crypto.randomBytes(4);
        this._socket.write(Buffer.from([0x88, 0x80, mask[0], mask[1], mask[2], mask[3]]));
      } catch { /* ignore */ }
      this._socket.destroy();
      this._socket = null;
    }
  }

  private _scheduleReconnect(): void {
    this._stopAllVncSessions();
    if (this._destroyed) { return; }
    // If a reconnect is already scheduled, don't schedule another.
    if (this._reconnectTimer) { return; }

    // Detach and destroy the old socket so its stale event listeners (close/error)
    // can't trigger another _scheduleReconnect() call after we've already queued one.
    const oldSocket = this._socket;
    this._socket = null;
    this._connected = false;
    this._buffer = Buffer.alloc(0);
    if (oldSocket) {
      oldSocket.removeAllListeners('data');
      oldSocket.removeAllListeners('close');
      oldSocket.removeAllListeners('error');
      oldSocket.destroy();
    }

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, WebSocketPoller.RECONNECT_DELAY_MS);
  }

  /** Parse and consume complete WebSocket frames from _buffer. */
  private _processBuffer(): void {
    while (true) {
      const frame = this._parseFrame();
      if (!frame) { break; }
      this._onFrame(frame.opcode, frame.payload);
    }
  }

  private _parseFrame(): { opcode: number; payload: Buffer } | null {
    if (this._buffer.length < 2) { return null; }

    const byte1 = this._buffer[0];
    const byte2 = this._buffer[1];
    const opcode = byte1 & 0x0f;
    const isMasked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (this._buffer.length < offset + 2) { return null; }
      payloadLen = this._buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (this._buffer.length < offset + 8) { return null; }
      // Use only the lower 32 bits (messages won't be >4 GB)
      payloadLen = this._buffer.readUInt32BE(offset + 4);
      offset += 8;
    }

    const maskBytes = isMasked ? 4 : 0;
    if (this._buffer.length < offset + maskBytes + payloadLen) { return null; }

    const mask = isMasked ? this._buffer.slice(offset, offset + 4) : null;
    offset += maskBytes;

    let payload = this._buffer.slice(offset, offset + payloadLen);
    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    // Consume frame from buffer
    this._buffer = this._buffer.slice(offset + payloadLen);

    return { opcode, payload };
  }

  private _onFrame(opcode: number, payload: Buffer): void {
    if (opcode === 0x9) {
      // Ping — reply with pong
      this._sendPong(payload);
      return;
    }
    if (opcode === 0x8) {
      // Close — reconnect
      this._connected = false;
      this._scheduleReconnect();
      return;
    }
    if (opcode !== 0x1) { return; } // only handle text frames

    let msg: Record<string, unknown>;
    try { msg = JSON.parse(payload.toString('utf8')); }
    catch { return; }

    const msgType = msg['type'] as string | undefined;

    // ── VNC frames from pixel-office ─────────────────────────────────────────

    // ── File browser requests from server ─────────────────────────────────────

    if (msgType === 'fb_request') {
      const requestId = msg['requestId'] as string | undefined;
      const action    = msg['action']    as string | undefined;
      const relPath   = (msg['path']    as string | undefined) ?? '';
      const content   = msg['content']  as string | undefined;
      const newPath   = msg['newPath']  as string | undefined;
      if (requestId && action) {
        this._handleFbRequest(requestId, action, relPath, content, newPath);
      }
      return;
    }

    if (msgType === 'vnc_session') {
      const action = msg['action'] as string | undefined;
      if (action === 'start') {
        const sessionId = msg['sessionId'] as string;
        const port      = Number(msg['port'] ?? 5900);
        // Prefer password from server frame; fall back to locally-configured password
        const password  = (msg['password'] as string | undefined) || this._vncPassword;
        this._log(`VNC session start: ${sessionId} → port ${port}`);

        const session = new VncSession(sessionId, (frame) => this.sendFrame(frame));
        this._vncSessions.set(sessionId, session);

        session.start(port, password).catch((err: Error) => {
          this._log(`VNC session ${sessionId} failed to start: ${err.message}`);
          this._vncSessions.delete(sessionId);
          this.sendFrame({ type: 'vnc_close', sessionId, reason: err.message });
        });
      }
      return;
    }

    if (msgType === 'vnc_input') {
      const sessionId = msg['sessionId'] as string | undefined;
      const event     = msg['event'] as Record<string, unknown> | undefined;
      if (sessionId && event) {
        this._vncSessions.get(sessionId)?.handleInput(event);
      }
      return;
    }

    if (msgType === 'vnc_close') {
      const sessionId = msg['sessionId'] as string | undefined;
      if (sessionId) {
        this._log(`VNC session closed: ${sessionId}`);
        this._vncSessions.get(sessionId)?.stop();
        this._vncSessions.delete(sessionId);
      }
      return;
    }

    // ── A2A task frame ────────────────────────────────────────────────────────

    // A2A task frame: { task: { id, contextId, status: { state }, metadata: { event, task, parts } } }
    if (msg['task']) {
      const t = msg['task'] as Record<string, unknown>;
      const state = (t['status'] as Record<string, unknown> | undefined)?.['state'] as string | undefined;
      if (state !== 'TASK_STATE_SUBMITTED') { return; }
      const meta = (t['metadata'] as Record<string, unknown> | undefined) ?? {};
      if (meta['event'] !== 'user_message') { return; }
      const taskObj = meta['task'] as Record<string, unknown> | undefined;
      let taskText = typeof taskObj?.['text'] === 'string' ? taskObj['text'] : '';

      // Handle A2A parts — extract text parts and save file parts as attachments
      const rawParts = meta['parts'] as Array<Record<string, unknown>> | undefined;
      const attRefs: string[] = [];
      if (rawParts) {
        for (const part of rawParts) {
          if (part['kind'] === 'text' && !taskText) {
            taskText = (part['text'] as string | undefined) ?? '';
          } else if (part['kind'] === 'file' && this._workspaceRoot) {
            const file = part['file'] as Record<string, unknown> | undefined;
            if (file) {
              const name = (file['name'] as string | undefined) ?? 'attachment';
              const bytesB64 = file['bytes'] as string | undefined;
              if (bytesB64) {
                const buf = Buffer.from(bytesB64, 'base64');
                const rel = saveAttachment(this._workspaceRoot, name, buf);
                attRefs.push(rel);
              } else if (typeof file['uri'] === 'string') {
                attRefs.push(file['uri'] as string);
              }
            }
          }
        }
      }

      if (!taskText) { return; }
      const fullText = attRefs.length > 0
        ? taskText + '\n' + attRefs.map(p => `[attachment: ${p}]`).join('\n')
        : taskText;

      // Deduplicate: skip if this exact task line is already present in TODO.md.
      // This prevents double-entries when the server re-delivers tasks on reconnect
      // (e.g. after a stale-socket delivery that was never actually received).
      try {
        if (this._todoPath && fs.existsSync(this._todoPath)) {
          const existing = fs.readFileSync(this._todoPath, 'utf8');
          if (existing.includes(`- [ ] ${taskText}`) || existing.includes(`- [x] ${taskText}`) || existing.includes(`- [~] ${taskText}`)) {
            this._log(`WS task already in TODO.md, skipping: "${taskText}"`);
            return;
          }
        }
      } catch { /* ignore read errors — proceed to append */ }

      this._log(`WS task received: "${taskText}"${attRefs.length > 0 ? ` (+${attRefs.length} attachment(s))` : ''}`);
      try {
        if (!this._todoPath) { throw new Error('todoPath is empty'); }
        fs.appendFileSync(this._todoPath, `\n- [ ] ${fullText}\n`, 'utf8');
      } catch (err) {
        this._log(`WS failed to append task to TODO.md: ${err}`);
      }
    }
  }

  /** Handle a file-browser request from the server (originated by the browser UI). */
  private _handleFbRequest(requestId: string, action: string, relPath: string, content?: string, newPath?: string): void {
    const respond = (ok: boolean, extra?: Record<string, unknown>) => {
      this.sendFrame({ type: 'fb_response', requestId, ok, ...extra });
    };

    const root = this._workspaceRoot;
    if (!root) {
      respond(false, { error: 'No workspace root configured' });
      return;
    }

    // Resolve and validate path is within workspace root
    const resolveSafe = (rel: string): string | null => {
      const resolved = path.resolve(root, rel);
      return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
    };

    const absPath = resolveSafe(relPath);
    if (!absPath) {
      respond(false, { error: 'Path outside workspace' });
      return;
    }

    try {
      switch (action) {
        case 'list': {
          const entries = fs.readdirSync(absPath, { withFileTypes: true }).map(e => {
            const stat = (() => { try { return fs.statSync(path.join(absPath, e.name)); } catch { return null; } })();
            return {
              name: e.name,
              type: e.isDirectory() ? 'dir' : 'file',
              size: stat?.size ?? 0,
              mtime: stat?.mtimeMs ?? 0,
            };
          });
          // Dirs first, then files; both alphabetical
          entries.sort((a, b) => {
            if (a.type !== b.type) { return a.type === 'dir' ? -1 : 1; }
            return a.name.localeCompare(b.name);
          });
          respond(true, { entries });
          break;
        }

        case 'read': {
          const stat = fs.statSync(absPath);
          const MAX_BYTES = 1_048_576; // 1 MB
          if (stat.size > MAX_BYTES) {
            respond(false, { error: `File too large (${stat.size} bytes, limit 1 MB)` });
            break;
          }
          // Binary detection: read first 512 bytes and check for null bytes
          const sample = Buffer.allocUnsafe(Math.min(512, stat.size));
          const fd = fs.openSync(absPath, 'r');
          fs.readSync(fd, sample, 0, sample.length, 0);
          fs.closeSync(fd);
          const isBinary = sample.includes(0x00);
          if (isBinary) {
            respond(false, { error: 'Binary file — cannot display' });
            break;
          }
          const fileContent = fs.readFileSync(absPath, 'utf8');
          respond(true, { content: fileContent });
          break;
        }

        case 'write': {
          if (content === undefined) {
            respond(false, { error: 'No content provided' });
            break;
          }
          fs.writeFileSync(absPath, content, 'utf8');
          respond(true);
          break;
        }

        case 'delete': {
          fs.rmSync(absPath, { recursive: true, force: true });
          respond(true);
          break;
        }

        case 'rename': {
          if (!newPath) {
            respond(false, { error: 'No newPath provided' });
            break;
          }
          const absNewPath = resolveSafe(newPath);
          if (!absNewPath) {
            respond(false, { error: 'newPath outside workspace' });
            break;
          }
          fs.renameSync(absPath, absNewPath);
          respond(true);
          break;
        }

        default:
          respond(false, { error: `Unknown action: ${action}` });
      }
    } catch (err) {
      respond(false, { error: String(err) });
    }
  }

  /** Stop all active VNC sessions (called on destroy/reconnect). */
  private _stopAllVncSessions(): void {
    for (const [id, session] of this._vncSessions) {
      this._log(`VNC session terminated (disconnect): ${id}`);
      session.stop();
    }
    this._vncSessions.clear();
  }

  /** Update the VNC password used for incoming vnc_session requests. */
  setVncPassword(password?: string): void {
    this._vncPassword = password;
  }

  /**
   * Send a JSON payload to the server over the WebSocket connection.
   * Queues the frame if not yet connected — always returns true (accepted).
   */
  sendFrame(payload: unknown): boolean {
    if (!this._connected || !this._socket) {
      this._pendingFrames.push(payload);
      return true;  // accepted into queue
    }
    this._sendTextFrame(JSON.stringify(payload));
    return true;
  }

  /** Send a masked WebSocket text frame. */
  private _sendTextFrame(text: string): void {
    if (!this._socket) { return; }

    const data = Buffer.from(text, 'utf8');
    const len = data.length;
    const mask = crypto.randomBytes(4);
    let header: Buffer;
    if (len <= 125) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = len | 0x80;
      mask.copy(header, 2);
    } else if (len <= 65535) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 126 | 0x80;
      header.writeUInt16BE(len, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 127 | 0x80;
      header.writeBigUInt64BE(BigInt(len), 2);
      mask.copy(header, 10);
    }
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) { masked[i] ^= mask[i % 4]; }
    this._socket.write(Buffer.concat([header, masked]));
  }

  private _sendPong(payload: Buffer): void {
    if (!this._socket) { return; }
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    const header = Buffer.alloc(2 + 4);
    header[0] = 0x8a; // FIN + pong opcode
    header[1] = (len & 0x7f) | 0x80; // masked, length (assumes len <= 125)
    mask.copy(header, 2);
    const maskedPayload = Buffer.from(payload);
    for (let i = 0; i < maskedPayload.length; i++) { maskedPayload[i] ^= mask[i % 4]; }
    this._socket.write(Buffer.concat([header, maskedPayload]));
  }
}

// ---------------------------------------------------------------------------
// WebhookPoller — public facade; routes to HTTP polling or WebSocket
// ---------------------------------------------------------------------------

export class WebhookPoller {
  private readonly _impl: HttpWebhookPoller | WebSocketPoller;

  constructor(baseUrl: string, apiKey: string, slug: string) {
    const isWs = baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://');
    this._impl = isWs
      ? new WebSocketPoller(baseUrl, apiKey, slug)
      : new HttpWebhookPoller(baseUrl, apiKey, slug);
  }

  /** Start the WebSocket connection (no-op for HTTP pollers). */
  start(todoPath: string, log?: (msg: string) => void, workspaceRoot?: string): void {
    if (this._impl instanceof WebSocketPoller) {
      this._impl.start(todoPath, log, workspaceRoot);
    }
  }

  /** Tear down any persistent connections. */
  destroy(): void {
    if (this._impl instanceof WebSocketPoller) {
      this._impl.destroy();
    }
  }

  /**
   * Poll once for the next pending task and append it to TODO.md.
   * For WebSocket mode: always returns false (tasks arrive via push).
   */
  pollAndAppend(todoPath: string, workspaceRoot?: string): Promise<boolean> {
    return this._impl.pollAndAppend(todoPath, workspaceRoot);
  }

  /**
   * Send a JSON frame to the server over the WebSocket connection.
   * No-op (returns false) in HTTP polling mode or when disconnected.
   */
  sendFrame(payload: unknown): boolean {
    if (this._impl instanceof WebSocketPoller) {
      return this._impl.sendFrame(payload);
    }
    return false;
  }

  /** Pass the VNC password to use when a vnc_session start arrives. */
  setVncPassword(password?: string): void {
    if (this._impl instanceof WebSocketPoller) {
      this._impl.setVncPassword(password);
    }
  }

  /** Register a callback to fire each time the WS connection is established. */
  setOnConnect(cb: () => void): void {
    if (this._impl instanceof WebSocketPoller) {
      this._impl.setOnConnect(cb);
    }
  }

  /** True when backed by a WebSocket connection (vs HTTP polling). */
  get isWebSocket(): boolean {
    return this._impl instanceof WebSocketPoller;
  }
}

// ---------------------------------------------------------------------------
// HttpWebhookPoller — original HTTP-polling implementation
// ---------------------------------------------------------------------------

class HttpWebhookPoller {
  private lastProcessedId = 0;
  private _etag: string | undefined;
  private _polling = false;
  private _lastPollTime = 0;
  private static readonly MIN_INTERVAL_MS = 3_000;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly slug: string,
  ) {}

  /**
   * Poll once for the next pending task and append it to TODO.md.
   * Returns true if a task was appended; false otherwise.
   * Skips if a previous poll is still in-flight, or if minimum interval hasn't elapsed.
   */
  async pollAndAppend(todoPath: string, workspaceRoot?: string): Promise<boolean> {
    // Skip if a previous request is still in progress
    if (this._polling) { return false; }

    // Enforce minimum 3-second gap between requests
    const elapsed = Date.now() - this._lastPollTime;
    if (this._lastPollTime > 0 && elapsed < HttpWebhookPoller.MIN_INTERVAL_MS) { return false; }

    this._polling = true;
    this._lastPollTime = Date.now();
    try {
      const qs = new URLSearchParams({
        status: 'pending',
        per_page: '1',
        endpoint_slug: this.slug,
      }).toString();

      const { data: listData, etag, notModified } = await this._getWithEtag<{ data?: LogListItem[] } | LogListItem[]>(
        `/v1/logs?${qs}`,
      );

      // Server says nothing changed — skip processing
      if (notModified) { return false; }

      // Store ETag for next request
      if (etag) { this._etag = etag; }

      // Handle both wrapped { data: [...] } and bare [...] responses
      const logs: LogListItem[] = Array.isArray(listData)
        ? listData
        : (listData as { data?: LogListItem[] }).data ?? [];

      if (logs.length === 0) { return false; }

      const log = logs[0];
      const logId = log.id;
      if (!logId || logId <= this.lastProcessedId) { return false; }

      const detail = await this._get<LogDetail>(`/v1/logs/${logId}`);

      // Mark received immediately regardless of outcome (don't re-deliver)
      this.lastProcessedId = logId;
      this._patch(`/v1/logs/${logId}`, { status: 'received' }).catch(() => {});

      // Extract payload — try both nesting styles
      const payload = detail.data?.payload ?? detail.payload;
      if (!payload || payload.event !== 'user_message') { return false; }

      let taskText = payload.task?.text ?? '';
      const attRefs: string[] = [];
      if (payload.parts && workspaceRoot) {
        for (const part of payload.parts) {
          if (part.kind === 'text' && !taskText) {
            taskText = part.text ?? '';
          } else if (part.kind === 'file' && part.file) {
            const name = part.file.name ?? 'attachment';
            const bytesB64 = part.file.bytes;
            if (bytesB64) {
              const buf = Buffer.from(bytesB64, 'base64');
              const rel = saveAttachment(workspaceRoot, name, buf);
              attRefs.push(rel);
            } else if (part.file.uri) {
              attRefs.push(part.file.uri);
            }
          }
        }
      }
      if (!taskText) { return false; }
      const fullText = attRefs.length > 0
        ? taskText + '\n' + attRefs.map(p => `[attachment: ${p}]`).join('\n')
        : taskText;

      fs.appendFileSync(todoPath, `\n- [ ] ${fullText}\n`, 'utf8');
      return true;
    } catch {
      return false;
    } finally {
      this._polling = false;
    }
  }

  // ---------------------------------------------------------------------------

  private _getWithEtag<T>(path: string): Promise<{ data: T; etag?: string; notModified: boolean }> {
    return jsonRequestWithEtag('GET', this.baseUrl, path, this.apiKey, this._etag);
  }

  private _get<T>(path: string): Promise<T> {
    return jsonRequest('GET', this.baseUrl, path, this.apiKey, undefined);
  }

  private _patch(path: string, body: unknown): Promise<unknown> {
    return jsonRequest('PATCH', this.baseUrl, path, this.apiKey, body);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequestWithEtag<T>(
  method: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  etag: string | undefined,
): Promise<{ data: T; etag?: string; notModified: boolean }> {
  return new Promise((resolve, reject) => {
    const rawUrl = baseUrl.replace(/\/$/, '') + path;
    const parsed = url.parse(rawUrl);

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'Accept': 'application/json',
      'User-Agent': 'AutoDev-VSCode/1.0',
    };
    if (etag) { headers['If-None-Match'] = etag; }

    const options: http.RequestOptions = {
      hostname: parsed.hostname ?? '',
      port: parsed.port,
      path: parsed.path ?? '/',
      method,
      headers,
    };

    const transport = rawUrl.startsWith('https') ? https : http;
    const req = transport.request(options, (res: import('http').IncomingMessage) => {
      if (res.statusCode === 304) {
        resolve({ data: {} as T, etag, notModified: true });
        return;
      }
      const responseEtag = res.headers['etag'] as string | undefined;
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (!data.trim()) { resolve({ data: {} as T, etag: responseEtag, notModified: false }); return; }
        try { resolve({ data: JSON.parse(data) as T, etag: responseEtag, notModified: false }); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(new Error('Request timed out')); });
    req.end();
  });
}

function jsonRequest<T>(
  method: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const rawUrl = baseUrl.replace(/\/$/, '') + path;
    const parsed = url.parse(rawUrl);
    const json = body !== undefined ? JSON.stringify(body) : undefined;

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'Accept': 'application/json',
      'User-Agent': 'AutoDev-VSCode/1.0',
    };
    if (json) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(json));
    }

    const options: http.RequestOptions = {
      hostname: parsed.hostname ?? '',
      port: parsed.port,
      path: parsed.path ?? '/',
      method,
      headers,
    };

    const transport = rawUrl.startsWith('https') ? https : http;
    const req = transport.request(options, (res: import('http').IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (!data.trim()) { resolve({} as T); return; }
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error('Invalid JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(new Error('Request timed out')); });
    if (json) { req.write(json); }
    req.end();
  });
}
