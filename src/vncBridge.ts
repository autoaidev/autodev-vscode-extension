/**
 * VncBridge — TypeScript port of rfb.py + wsvnc.py
 *
 * Connects to a local VNC server via TCP, performs the RFB handshake,
 * and emits decoded framebuffer rectangles that VncSession encodes and
 * sends back over the agent's WebSocket connection to pixel-office.
 */

import * as net from 'net';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// RFB constants
// ---------------------------------------------------------------------------

const RAW_ENCODING  = 0;
const COPY_RECT     = 1;

// X11 keysym translations for special keys (JS keyCode → X11)
export const KEYSYM: Record<number, number> = {
  8:  0xff08, // BackSpace
  9:  0xff09, // Tab
  13: 0xff0d, // Return
  27: 0xff1b, // Escape
  35: 0xff57, // End
  36: 0xff50, // Home
  37: 0xff51, // Left
  38: 0xff52, // Up
  39: 0xff53, // Right
  40: 0xff54, // Down
  45: 0xff63, // Insert
  46: 0xffff, // Delete
  112: 0xffbe, 113: 0xffbf, 114: 0xffc0, 115: 0xffc1, // F1-F4
  116: 0xffc2, 117: 0xffc3, 118: 0xffc4, 119: 0xffc5, // F5-F8
  120: 0xffc6, 121: 0xffc7, 122: 0xffc8, 123: 0xffc9, // F9-F12
  16: 0xffe1, // Shift
  17: 0xffe3, // Ctrl
  18: 0xffe9, // Alt
  91: 0xffeb, // Meta/Super
};

export interface VncRect {
  x: number; y: number; w: number; h: number;
  encoding: 'Raw' | 'CopyRect';
  data: Buffer;      // raw BGRA bytes for Raw; 4 bytes (srcX, srcY) for CopyRect
}

export interface VncInfo {
  name: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// VncBridge — manages one TCP connection to a local VNC server
// ---------------------------------------------------------------------------

export class VncBridge extends EventEmitter {
  private sock: net.Socket | null = null;
  private _width  = 0;
  private _height = 0;
  private _bypp   = 4; // bytes per pixel (after we negotiate 32bpp)
  private _recvBuf = Buffer.alloc(0);
  private _closed = false;

  get width()  { return this._width; }
  get height() { return this._height; }

  /** Connect to VNC on localhost:port. Resolves once handshake is complete. */
  connect(port: number, password?: string): Promise<VncInfo> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(port, '127.0.0.1');
      this.sock = sock;

      sock.on('error', (err) => {
        if (!this._closed) { this._closed = true; this.emit('error', err); reject(err); }
      });
      sock.on('close', () => {
        if (!this._closed) { this._closed = true; this.emit('close'); }
      });

      // Handshake state machine
      let state: 'version' | 'auth_type' | 'auth_challenge' | 'auth_result' |
                 'server_init' | 'server_name' | 'running' = 'version';
      let nameLen = 0;
      let challenge: Buffer | null = null;

      sock.on('data', (chunk: Buffer) => {
        this._recvBuf = Buffer.concat([this._recvBuf, chunk]);

        while (true) {
          if (state === 'version') {
            const nl = this._recvBuf.indexOf(0x0a); // \n
            if (nl === -1) break;
            const verStr = this._recvBuf.slice(0, nl + 1).toString('ascii');
            this._recvBuf = this._recvBuf.slice(nl + 1);
            if (!verStr.startsWith('RFB ')) { reject(new Error('Not an RFB server')); sock.destroy(); return; }
            sock.write('RFB 003.003\n');
            state = 'auth_type';

          } else if (state === 'auth_type') {
            if (this._recvBuf.length < 4) break;
            const authType = this._recvBuf.readUInt32BE(0);
            this._recvBuf = this._recvBuf.slice(4);
            if (authType === 0) { reject(new Error('VNC server rejected connection')); sock.destroy(); return; }
            if (authType === 1) {
              // No auth — send shared flag (0 = exclusive)
              sock.write(Buffer.from([0]));
              state = 'server_init';
            } else if (authType === 2) {
              // VNC auth — need 16-byte challenge
              state = 'auth_challenge';
            } else {
              reject(new Error(`Unsupported VNC auth type: ${authType}`)); sock.destroy(); return;
            }

          } else if (state === 'auth_challenge') {
            if (this._recvBuf.length < 16) break;
            challenge = this._recvBuf.slice(0, 16);
            this._recvBuf = this._recvBuf.slice(16);
            if (!password) { reject(new Error('VNC server requires password')); sock.destroy(); return; }
            const response = vncDesResponse(challenge, password);
            sock.write(response);
            state = 'auth_result';

          } else if (state === 'auth_result') {
            if (this._recvBuf.length < 4) break;
            const result = this._recvBuf.readUInt32BE(0);
            this._recvBuf = this._recvBuf.slice(4);
            if (result !== 0) { reject(new Error('VNC authentication failed')); sock.destroy(); return; }
            sock.write(Buffer.from([0])); // shared flag
            state = 'server_init';

          } else if (state === 'server_init') {
            if (this._recvBuf.length < 24) break;
            this._width  = this._recvBuf.readUInt16BE(0);
            this._height = this._recvBuf.readUInt16BE(2);
            // pixformat is bytes 4-19 (16 bytes), then 4 bytes name length
            const bpp = this._recvBuf[4];
            this._bypp = bpp / 8;
            nameLen = this._recvBuf.readUInt32BE(20);
            this._recvBuf = this._recvBuf.slice(24);
            state = 'server_name';

          } else if (state === 'server_name') {
            if (this._recvBuf.length < nameLen) break;
            const name = this._recvBuf.slice(0, nameLen).toString('utf8');
            this._recvBuf = this._recvBuf.slice(nameLen);
            state = 'running';

            // Negotiate pixel format: 32bpp, depth 24, little-endian, true-color
            // BGRA layout (B=shift0, G=shift8, R=shift16, A ignored) → browser ImageData wants RGBA
            this._sendSetPixelFormat();
            this._sendSetEncodings([RAW_ENCODING, COPY_RECT]);

            resolve({ name, width: this._width, height: this._height });

          } else if (state === 'running') {
            if (!this._parseServerMessage()) break;
          }
        }
      });
    });
  }

  /** Request a framebuffer update from the VNC server. */
  requestUpdate(x = 0, y = 0, w?: number, h?: number, incremental = 1): void {
    if (!this.sock || this._closed) return;
    const fw = w ?? this._width;
    const fh = h ?? this._height;
    const buf = Buffer.alloc(10);
    buf[0] = 3; buf[1] = incremental;
    buf.writeUInt16BE(x, 2); buf.writeUInt16BE(y, 4);
    buf.writeUInt16BE(fw, 6); buf.writeUInt16BE(fh, 8);
    this.sock.write(buf);
  }

  /** Send a key event to the VNC server. */
  sendKey(keysym: number, down: boolean): void {
    if (!this.sock || this._closed) return;
    const buf = Buffer.alloc(8);
    buf[0] = 4; buf[1] = down ? 1 : 0;
    buf.writeUInt32BE(keysym, 4);
    this.sock.write(buf);
  }

  /** Send a pointer (mouse) event to the VNC server. */
  sendMouse(x: number, y: number, buttonMask: number): void {
    if (!this.sock || this._closed) return;
    const buf = Buffer.alloc(6);
    buf[0] = 5; buf[1] = buttonMask;
    buf.writeUInt16BE(x, 2); buf.writeUInt16BE(y, 4);
    this.sock.write(buf);
  }

  close(): void {
    if (!this._closed) { this._closed = true; this.sock?.destroy(); }
  }

  // ---------------------------------------------------------------------------
  // Private: sending
  // ---------------------------------------------------------------------------

  private _sendSetPixelFormat(): void {
    if (!this.sock) return;
    // SetPixelFormat: type=0, 3 padding, then 16-byte pixel format
    // 32bpp, depth=24, big-endian=0, true-color=1
    // red: max=255 shift=16, green: max=255 shift=8, blue: max=255 shift=0
    const buf = Buffer.alloc(20);
    buf[0] = 0;              // message type
    // 3 padding bytes
    buf[4] = 32;             // bits-per-pixel
    buf[5] = 24;             // depth
    buf[6] = 0;              // big-endian flag
    buf[7] = 1;              // true-colour flag
    buf.writeUInt16BE(255, 8);  // red-max
    buf.writeUInt16BE(255, 10); // green-max
    buf.writeUInt16BE(255, 12); // blue-max
    buf[14] = 16;            // red-shift
    buf[15] = 8;             // green-shift
    buf[16] = 0;             // blue-shift
    this.sock.write(buf);
    this._bypp = 4;
  }

  private _sendSetEncodings(encodings: number[]): void {
    if (!this.sock) return;
    const buf = Buffer.alloc(4 + encodings.length * 4);
    buf[0] = 2; // message type
    buf.writeUInt16BE(encodings.length, 2);
    for (let i = 0; i < encodings.length; i++) {
      buf.writeInt32BE(encodings[i], 4 + i * 4);
    }
    this.sock.write(buf);
  }

  // ---------------------------------------------------------------------------
  // Private: parsing incoming server messages
  // ---------------------------------------------------------------------------

  /** Returns true if a complete message was consumed, false if more data needed. */
  private _parseServerMessage(): boolean {
    if (this._recvBuf.length < 1) return false;
    const msgType = this._recvBuf[0];

    if (msgType === 0) {
      return this._parseFBU();
    } else if (msgType === 2) {
      // Bell — just consume the 1-byte message
      this._recvBuf = this._recvBuf.slice(1);
      return true;
    } else if (msgType === 3) {
      // ServerCutText — consume header + text
      if (this._recvBuf.length < 8) return false;
      const len = this._recvBuf.readUInt32BE(4);
      if (this._recvBuf.length < 8 + len) return false;
      this._recvBuf = this._recvBuf.slice(8 + len);
      return true;
    } else {
      // Unknown message — can't recover, close
      this.emit('error', new Error(`Unknown RFB server message type: ${msgType}`));
      this.close();
      return false;
    }
  }

  private _parseFBU(): boolean {
    // FramebufferUpdate: type(1) + padding(1) + count(2) = 4 header bytes
    if (this._recvBuf.length < 4) return false;
    const rectCount = this._recvBuf.readUInt16BE(2);
    let offset = 4;

    for (let i = 0; i < rectCount; i++) {
      if (this._recvBuf.length < offset + 12) return false; // rect header: x,y,w,h,encoding = 12 bytes
      const x = this._recvBuf.readUInt16BE(offset);
      const y = this._recvBuf.readUInt16BE(offset + 2);
      const w = this._recvBuf.readUInt16BE(offset + 4);
      const h = this._recvBuf.readUInt16BE(offset + 6);
      const enc = this._recvBuf.readInt32BE(offset + 8);
      offset += 12;

      if (enc === RAW_ENCODING) {
        const pixelBytes = w * h * this._bypp;
        if (this._recvBuf.length < offset + pixelBytes) return false;
        const data = Buffer.from(this._recvBuf.slice(offset, offset + pixelBytes));
        offset += pixelBytes;
        this.emit('frame', { x, y, w, h, encoding: 'Raw', data } as VncRect);

      } else if (enc === COPY_RECT) {
        if (this._recvBuf.length < offset + 4) return false;
        const data = Buffer.from(this._recvBuf.slice(offset, offset + 4));
        offset += 4;
        this.emit('frame', { x, y, w, h, encoding: 'CopyRect', data } as VncRect);

      } else {
        this.emit('error', new Error(`Unsupported encoding: ${enc}`));
        this.close();
        return false;
      }
    }

    this._recvBuf = this._recvBuf.slice(offset);
    return true;
  }
}

// ---------------------------------------------------------------------------
// VncSession — one tunnel: VncBridge ↔ WS sender ↔ pixel-office
// ---------------------------------------------------------------------------

export class VncSession {
  private bridge: VncBridge | null = null;
  private _active = false;
  private _pendingFuq = false; // true while waiting for a frame response

  constructor(
    private readonly sessionId: string,
    private readonly wsSender: (frame: Record<string, unknown>) => boolean,
  ) {}

  async start(port: number, password?: string): Promise<void> {
    const bridge = new VncBridge();
    this.bridge = bridge;

    bridge.on('error', (err: Error) => {
      this.wsSender({ type: 'vnc_close', sessionId: this.sessionId, reason: err.message });
      this._active = false;
    });

    bridge.on('close', () => {
      this.wsSender({ type: 'vnc_close', sessionId: this.sessionId, reason: 'vnc_disconnected' });
      this._active = false;
    });

    bridge.on('frame', (rect: VncRect) => {
      this._pendingFuq = false;
      this.wsSender({
        type:      'vnc_frame',
        sessionId: this.sessionId,
        rect:      { x: rect.x, y: rect.y, w: rect.w, h: rect.h, encoding: rect.encoding },
        data:      rect.data.toString('base64'),
      });
    });

    const info = await bridge.connect(port, password);
    this._active = true;

    // Announce ready to browser
    this.wsSender({
      type:      'vnc_ready',
      sessionId: this.sessionId,
      name:      info.name,
      width:     info.width,
      height:    info.height,
    });

    // Request the initial full framebuffer
    bridge.requestUpdate(0, 0, info.width, info.height, 0);
    this._pendingFuq = true;
  }

  handleInput(event: Record<string, unknown>): void {
    if (!this.bridge || !this._active) return;
    const t = event['type'] as string;

    if (t === 'fuq') {
      // Browser is requesting next frame (demand-driven)
      if (!this._pendingFuq) {
        this.bridge.requestUpdate(
          Number(event['x'] ?? 0), Number(event['y'] ?? 0),
          event['w'] ? Number(event['w']) : undefined,
          event['h'] ? Number(event['h']) : undefined,
          Number(event['incremental'] ?? 1),
        );
        this._pendingFuq = true;
      }

    } else if (t === 'pe') {
      // Pointer event: { x, y, buttonMask }
      this.bridge.sendMouse(
        Number(event['x'] ?? 0),
        Number(event['y'] ?? 0),
        Number(event['buttonMask'] ?? 0),
      );

    } else if (t === 'ke') {
      // Key event: { keyCode, down }
      const jsKey = Number(event['keyCode'] ?? 0);
      const keysym = KEYSYM[jsKey] ?? jsKey;
      this.bridge.sendKey(keysym, Boolean(event['down']));
    }
  }

  stop(): void {
    this._active = false;
    this.bridge?.close();
    this.bridge = null;
  }
}

// ---------------------------------------------------------------------------
// VNC DES challenge-response (auth type 2)
// Implements the "crippled DES" used by VNC: key bits are reversed per byte,
// and the password is used as the DES key to encrypt the 16-byte challenge.
// ---------------------------------------------------------------------------

function vncDesResponse(challenge: Buffer, password: string): Buffer {
  const pw = password.padEnd(8, '\0').slice(0, 8);
  // Reverse bits in each byte of the key (VNC quirk)
  const key = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    key[i] = reverseBits(pw.charCodeAt(i));
  }
  const result = Buffer.alloc(16);
  desEncrypt(challenge.slice(0, 8), key).copy(result, 0);
  desEncrypt(challenge.slice(8, 16), key).copy(result, 8);
  return result;
}

function reverseBits(b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    r = (r << 1) | (b & 1);
    b >>= 1;
  }
  return r;
}

// Minimal single-block DES ECB encrypt (no padding).
// Uses Node's built-in crypto with des-ecb.
function desEncrypt(block: Buffer, key: Buffer): Buffer {
  // Node crypto supports 'des-ecb' with an 8-byte key
  const crypto = require('crypto') as typeof import('crypto');
  const cipher = crypto.createCipheriv('des-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}
