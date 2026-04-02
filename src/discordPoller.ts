import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// DiscordPoller — mirrors PHP DiscordTaskProvider (poll / drainQueue / react)
//
// Uses the Discord REST API to:
//   • Poll the channel for new messages from authorised owners
//   • Append received tasks to TODO.md
//   • React ✅ to every accepted message
//   • Fetch text from any file attachments and include them in the task
// ---------------------------------------------------------------------------

interface DiscordMessage {
  id: string;
  content: string;
  channel_id: string;
  author: { id: string; username: string; bot?: boolean };
  attachments: Array<{ url: string; filename: string }>;
}

interface QueuedTask {
  taskText: string;
  messageId: string;
}

const DISCORD_API = 'https://discord.com/api/v10';
const POLL_LIMIT = 10;

export class DiscordPoller {
  private lastMessageId: string | null = null;
  private queue: QueuedTask[] = [];
  private readonly owners: string[];

  /**
   * @param botToken       Discord bot token
   * @param channelId      Discord channel snowflake ID
   * @param ownersStr      Comma-separated list of usernames or user IDs allowed to send tasks
   */
  constructor(
    private readonly botToken: string,
    private readonly channelId: string,
    ownersStr: string,
  ) {
    this.owners = ownersStr.split(',').map(o => o.trim()).filter(Boolean);
  }

  /**
   * Seed lastMessageId with the current latest message in the channel so that
   * only messages arriving AFTER this point are treated as new tasks.
   * Call this once before starting the polling loop.
   */
  async initialize(): Promise<void> {
    try {
      const apiUrl = `${DISCORD_API}/channels/${this.channelId}/messages?limit=1`;
      const body = await apiGet(apiUrl, this.botToken);
      if (Array.isArray(body) && body.length > 0) {
        this.lastMessageId = (body[0] as DiscordMessage).id;
      }
    } catch { /* non-fatal — will just process existing messages on first poll */ }
  }

  /**
   * Poll the channel for new messages and append the first queued task to TODO.md.
   * Returns true if a task was appended (caller should break out of its wait sleep).
   */
  async pollAndAppend(todoPath: string): Promise<boolean> {
    await this._fetchNewMessages();
    return this._drainQueue(todoPath);
  }

  // ---------------------------------------------------------------------------

  private async _fetchNewMessages(): Promise<void> {
    try {
      const qs = this.lastMessageId
        ? `?after=${this.lastMessageId}&limit=${POLL_LIMIT}`
        : `?limit=${POLL_LIMIT}`;
      const apiUrl = `${DISCORD_API}/channels/${this.channelId}/messages${qs}`;
      const body = await apiGet(apiUrl, this.botToken);
      if (!Array.isArray(body)) { return; }

      // Discord returns newest-first; reverse to process oldest first
      const messages = (body as DiscordMessage[]).reverse();

      for (const msg of messages) {
        // Advance cursor unconditionally so we never re-process messages
        if (!this.lastMessageId || msg.id > this.lastMessageId) {
          this.lastMessageId = msg.id;
        }

        if (msg.author?.bot) { continue; }

        const username = msg.author?.username ?? '';
        const userId = msg.author?.id ?? '';
        const isOwner = this.owners.some(
          o => o.toLowerCase() === username.toLowerCase() || o === userId,
        );
        if (!isOwner) { continue; }

        const parts: string[] = [];
        const text = (msg.content ?? '').trim();
        if (text) { parts.push(text); }

        // Fetch content of any attached files
        for (const att of (msg.attachments ?? [])) {
          const attContent = await fetchAttachment(att.url, this.botToken);
          if (attContent !== null) {
            parts.push(`--- attachment: ${att.filename} ---\n${attContent}`);
          }
        }

        if (parts.length === 0) { continue; }

        const taskText = parts.join('\n');
        this.queue.push({ taskText, messageId: msg.id });

        // React ✅ to the message so the sender knows it was accepted
        reactToMessage(this.botToken, this.channelId, msg.id, '✅').catch(() => {});
      }
    } catch {
      // Polling failures are non-fatal — the loop will try again next tick
    }
  }

  private _drainQueue(todoPath: string): boolean {
    if (this.queue.length === 0) { return false; }
    const { taskText } = this.queue.shift()!;
    try {
      fs.appendFileSync(todoPath, `\n- [ ] ${taskText}\n`, 'utf8');
    } catch { /* non-fatal */ }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiGet(rawUrl: string, botToken: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(rawUrl);
    const options: http.RequestOptions = {
      hostname: parsed.hostname ?? '',
      port: parsed.port,
      path: parsed.path ?? '/',
      method: 'GET',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'User-Agent': 'AutoDev-VSCode/1.0',
        'Content-Type': 'application/json',
      },
    };
    const transport = rawUrl.startsWith('https') ? https : http;
    const req = transport.request(options, res => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('Request timed out')); });
    req.end();
  });
}

async function fetchAttachment(attUrl: string, botToken: string): Promise<string | null> {
  try {
    const body = await apiGet(attUrl, botToken);
    return typeof body === 'string' ? body : JSON.stringify(body);
  } catch { return null; }
}

function reactToMessage(botToken: string, channelId: string, messageId: string, emoji: string): Promise<void> {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(emoji);
    const rawUrl = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`;
    const parsed = url.parse(rawUrl);
    const options: http.RequestOptions = {
      hostname: parsed.hostname ?? '',
      port: parsed.port,
      path: parsed.path ?? '/',
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'User-Agent': 'AutoDev-VSCode/1.0',
        'Content-Length': '0',
      },
    };
    const req = https.request(options, res => { res.resume(); resolve(); });
    req.on('error', () => resolve()); // non-fatal
    req.setTimeout(5_000, () => { req.destroy(); resolve(); });
    req.end();
  });
}
