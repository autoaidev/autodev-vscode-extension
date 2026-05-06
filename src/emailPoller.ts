import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { saveAttachment } from './messageBuilder';
import { appendTask, shortId } from './todo';

// ---------------------------------------------------------------------------
// EmailTaskPoller — mirrors discordPoller / webhookPoller for IMAP inboxes.
//
// Connects via imapflow, watches INBOX, and for each new message from an
// allowed sender:
//   • parses MIME with mailparser
//   • saves every attachment via saveAttachment() to .autodev/messages/attachments/
//   • appends a task to TODO.md combining subject + body + attachment paths
//   • marks the message \Seen so it isn't reprocessed after a restart
//
// Connection is opened lazily and reused across polls. Recreated on error.
// ---------------------------------------------------------------------------

export interface EmailPollerOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** Empty array = allow every sender. */
  allowedSenders: string[];
  /** Verify TLS cert. Default true. */
  rejectUnauthorized?: boolean;
}

export class EmailTaskPoller {
  private client: ImapFlow | null = null;
  private connecting: Promise<void> | null = null;
  private readonly allowed: Set<string>;
  /** UID watermark — only fetch UIDs strictly greater than this. */
  private lastUid = 0;

  constructor(private readonly opts: EmailPollerOptions) {
    this.allowed = new Set(opts.allowedSenders.map(s => s.toLowerCase().trim()).filter(Boolean));
  }

  /**
   * Connect once and seed lastUid with the current uidNext-1 so only mail
   * arriving AFTER startup becomes a task on the first poll. Existing UNSEEN
   * mail in the inbox is still ignored — call pollAndAppend() to drain
   * truly-new mail and any UNSEEN since the last successful poll.
   */
  async initialize(): Promise<void> {
    await this._ensureConnected();
    if (!this.client) return;
    const status = await this.client.status('INBOX', { uidNext: true });
    this.lastUid = (status.uidNext ?? 1) - 1;
  }

  async pollAndAppend(todoPath: string, workspaceRoot?: string): Promise<boolean> {
    if (!workspaceRoot) return false;
    let appended = false;
    try {
      await this._ensureConnected();
      if (!this.client) return false;
      const lock = await this.client.getMailboxLock('INBOX');
      try {
        const range = `${this.lastUid + 1}:*`;
        // imapflow's fetch is an async iterator. `source: true` gives us raw
        // RFC822 bytes for mailparser to parse — recommended pairing per
        // https://imapflow.com/docs/guides/fetching-messages
        for await (const msg of this.client.fetch(range, { uid: true, envelope: true, source: true }, { uid: true })) {
          if (!msg.uid || msg.uid <= this.lastUid) continue;
          this.lastUid = msg.uid;
          if (!this._senderAllowed(msg)) continue;
          try {
            const taskText = await this._buildTaskFromMessage(msg, workspaceRoot);
            if (taskText) {
              appendTask(todoPath, taskText, shortId());
              appended = true;
            }
            await this.client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
          } catch {
            // Don't advance lastUid back — a bad message shouldn't loop forever.
          }
        }
      } finally {
        lock.release();
      }
    } catch {
      // Drop the connection so the next poll reconnects cleanly.
      try { await this.client?.logout(); } catch { /* ignore */ }
      this.client = null;
      this.connecting = null;
    }
    return appended;
  }

  async dispose(): Promise<void> {
    try { await this.client?.logout(); } catch { /* ignore */ }
    this.client = null;
    this.connecting = null;
  }

  // -------------------------------------------------------------------------

  private async _ensureConnected(): Promise<void> {
    if (this.client && this.client.usable) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const c = new ImapFlow({
        host: this.opts.host,
        port: this.opts.port,
        secure: this.opts.secure,
        auth: { user: this.opts.user, pass: this.opts.pass },
        logger: false,
        tls: { rejectUnauthorized: this.opts.rejectUnauthorized !== false },
      });
      await c.connect();
      this.client = c;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private _senderAllowed(msg: FetchMessageObject): boolean {
    if (this.allowed.size === 0) return true;
    const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
    return !!from && this.allowed.has(from);
  }

  private async _buildTaskFromMessage(msg: FetchMessageObject, workspaceRoot: string): Promise<string> {
    const source = msg.source;
    if (!source) return '';
    const parsed: ParsedMail = await simpleParser(source);
    const subject = (parsed.subject || msg.envelope?.subject || '(no subject)').trim();
    const fromAddr = parsed.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? 'unknown';
    const body = (parsed.text || '').trim();

    const attachmentLines: string[] = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
      const groupId = `email_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      for (const att of parsed.attachments) {
        const name = att.filename || `attachment_${attachmentLines.length + 1}`;
        const rel = saveAttachment(workspaceRoot, name, att.content, groupId);
        attachmentLines.push(`- [${name}](${rel})`);
      }
    }

    const parts = [`${subject} (from ${fromAddr})`];
    if (body) parts.push('', body);
    if (attachmentLines.length) parts.push('', 'Attachments:', ...attachmentLines);
    // Collapse hard newlines — appendTask writes a single line. Use ` \\ ` as a
    // soft-break marker so the agent reading TODO.md still sees structure.
    return parts.join(' \\\\ ');
  }
}
