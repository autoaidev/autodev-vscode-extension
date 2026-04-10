/**
 * VncSession — one tunnel: VncBridge ↔ WS sender ↔ pixel-office.
 *
 * Wraps a single VncBridge instance and drives the demand-driven
 * framebuffer update cycle (browser sends 'fuq' → request → frame → ack).
 */

import { VncBridge } from './bridge';
import { KEYSYM } from './constants';
import * as zlib from 'zlib';
import type { VncRect } from './types';

export class VncSession {
  private _bridge: VncBridge | null = null;
  private _active     = false;
  private _pendingFuq = false; // true while we're waiting for a frame reply

  constructor(
    private readonly sessionId: string,
    private readonly wsSender: (frame: Record<string, unknown>) => boolean,
  ) {}

  async start(port: number, password?: string, username?: string): Promise<void> {
    const bridge = new VncBridge();
    this._bridge = bridge;

    bridge.on('error', (err: Error) => {
      this.wsSender({ type: 'vnc_close', sessionId: this.sessionId, reason: err.message });
      this._active = false;
    });

    bridge.on('close', () => {
      if (this._active) {
        this.wsSender({ type: 'vnc_close', sessionId: this.sessionId, reason: 'vnc_disconnected' });
        this._active = false;
      }
    });

    bridge.on('frame', (rect: VncRect) => {
      this._pendingFuq = false;

      // Compress Raw frames with deflate-raw for bandwidth savings.
      // Level 1 (Z_BEST_SPEED) gives ~3-5x size reduction with minimal CPU cost.
      let data: string;
      let compressed = false;
      if (rect.encoding === 'Raw' && rect.data.length > 512) {
        const deflated = zlib.deflateRawSync(rect.data, { level: 1 });
        if (deflated.length < rect.data.length) {
          data = deflated.toString('base64');
          compressed = true;
        } else {
          data = rect.data.toString('base64');
        }
      } else {
        data = rect.data.toString('base64');
      }

      this.wsSender({
        type:       'vnc_frame',
        sessionId:  this.sessionId,
        rect:       { x: rect.x, y: rect.y, w: rect.w, h: rect.h, encoding: rect.encoding },
        data,
        compressed,
      });
    });

    const info = await bridge.connect(port, password, username);
    this._active = true;

    this.wsSender({
      type:      'vnc_ready',
      sessionId: this.sessionId,
      name:      info.name,
      width:     info.width,
      height:    info.height,
    });

    // Request initial full framebuffer (incremental=0)
    bridge.requestUpdate(0, 0, info.width, info.height, 0);
    this._pendingFuq = true;
  }

  handleInput(event: Record<string, unknown>): void {
    if (!this._bridge || !this._active) return;
    const t = event['type'] as string;

    if (t === 'fuq') {
      // Demand-driven: browser asks for the next frame
      if (!this._pendingFuq) {
        this._bridge.requestUpdate(
          Number(event['x'] ?? 0),
          Number(event['y'] ?? 0),
          event['w'] ? Number(event['w']) : undefined,
          event['h'] ? Number(event['h']) : undefined,
          Number(event['incremental'] ?? 1),
        );
        this._pendingFuq = true;
      }

    } else if (t === 'pe') {
      // Pointer event: { x, y, buttonMask }
      this._bridge.sendMouse(
        Number(event['x'] ?? 0),
        Number(event['y'] ?? 0),
        Number(event['buttonMask'] ?? 0),
      );

    } else if (t === 'ke') {
      // Key event: { keyCode, down }
      const jsKey  = Number(event['keyCode'] ?? 0);
      const keysym = KEYSYM[jsKey] ?? jsKey;
      this._bridge.sendKey(keysym, Boolean(event['down']));
    }
  }

  stop(): void {
    this._active = false;
    this._bridge?.close();
    this._bridge = null;
  }
}
