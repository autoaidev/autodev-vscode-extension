import * as https from 'https';
import * as http from 'http';
import * as url from 'url';

// ---------------------------------------------------------------------------
// Webhook client — mirrors PHP WebhookClient
// ---------------------------------------------------------------------------

export type WebhookEvent =
  | 'agent_online'
  | 'loop_start'
  | 'task_start'
  | 'task_done'
  | 'task_failed'
  | 'all_tasks_done';

export interface WebhookPayload {
  event: WebhookEvent;
  task?: string;
  remaining?: number;
  error?: string;
  timestamp: string;
}

/** POST a JSON event to a webhook URL. Fire-and-forget (no await). */
export function sendWebhook(webhookUrl: string, event: WebhookEvent, extra?: Partial<WebhookPayload>): void {
  if (!webhookUrl) { return; }

  const body: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  postJson(webhookUrl, body).catch(_err => {
    // Webhook failures are non-fatal — silently drop
  });
}

// ---------------------------------------------------------------------------
// Discord webhook client — POST a simple message embed
// ---------------------------------------------------------------------------

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

/** POST a message to a Discord webhook URL. Fire-and-forget. */
export function sendDiscordWebhook(webhookUrl: string, content: string, embed?: DiscordEmbed): void {
  if (!webhookUrl) { return; }

  const body: Record<string, unknown> = { content };
  if (embed) {
    body.embeds = [embed];
  }

  postJson(webhookUrl, body).catch(_err => {
    // Discord failures are non-fatal
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postJson(rawUrl: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(rawUrl);
    const json = JSON.stringify(body);

    const options: http.RequestOptions = {
      hostname: parsed.hostname ?? '',
      port: parsed.port,
      path: parsed.path ?? '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'User-Agent': 'AutoDev-VSCode/1.0',
      },
    };

    const transport = rawUrl.startsWith('https') ? https : http;
    const req = transport.request(options, res => {
      res.resume(); // drain response
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Webhook responded with HTTP ${res.statusCode}`));
      } else {
        resolve();
      }
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('Webhook request timed out')); });
    req.write(json);
    req.end();
  });
}
