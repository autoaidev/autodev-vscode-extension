import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// WebhookPoller — mirrors PHP AutodevWebhookTaskProvider
//
// Polls the autodev webhook server for pending `user_message` log entries
// (filtered by endpoint slug), appends their task text to TODO.md, and marks
// each log as "received" so the server does not re-deliver it.
//
// API used:
//   GET  {baseUrl}/v1/logs?status=pending&per_page=1&endpoint_slug={slug}
//   GET  {baseUrl}/v1/logs/{id}
//   PATCH {baseUrl}/v1/logs/{id}  { status: 'received' }
//
// Auth: X-API-Key header
// ---------------------------------------------------------------------------

interface LogListItem {
  id: number;
}

interface LogDetail {
  id: number;
  data?: {
    payload?: {
      event?: string;
      task?: { text?: string };
    };
  };
  // Some servers embed payload directly
  payload?: {
    event?: string;
    task?: { text?: string };
  };
}

export class WebhookPoller {
  private lastProcessedId = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly slug: string,
  ) {}

  /**
   * Poll once for the next pending task and append it to TODO.md.
   * Returns true if a task was appended; false otherwise.
   */
  async pollAndAppend(todoPath: string): Promise<boolean> {
    try {
      const qs = new URLSearchParams({
        status: 'pending',
        per_page: '1',
        endpoint_slug: this.slug,
      }).toString();

      const listData = await this._get<{ data?: LogListItem[] } | LogListItem[]>(
        `/v1/logs?${qs}`,
      );

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

      const taskText = payload.task?.text;
      if (!taskText) { return false; }

      fs.appendFileSync(todoPath, `\n- [ ] ${taskText}\n`, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------

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
