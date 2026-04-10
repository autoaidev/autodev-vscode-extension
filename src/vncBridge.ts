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

// Pure-TypeScript DES single-block encrypt — works on any Node/OpenSSL version.
// Uses a bit-array representation for clarity and correctness.
// Only the primitives VNC auth needs: 8-byte key, 8-byte block, ECB, no padding.

type _Bits = number[]; // each element is 0 or 1

// Permutation tables (1-based indices, standard DES spec)
const _DPC1=[57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const _DPC2=[14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const _DIP =[58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const _DFP =[40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const _DE  =[32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const _DP  =[16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const _DS  = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];
const _DSHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];

function _bufToBits(buf: Buffer): _Bits {
  const bits: _Bits = [];
  for (const byte of buf) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  return bits;
}
function _bitsToBuf(bits: _Bits): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0);
    bytes.push(b);
  }
  return Buffer.from(bytes);
}
function _dperm(bits: _Bits, table: number[]): _Bits {
  return table.map(p => bits[p - 1]); // 1-based
}
function _dxor(a: _Bits, b: _Bits): _Bits { return a.map((v, i) => v ^ b[i]); }
function _drotl(arr: _Bits, n: number): void {
  const head = arr.splice(0, n);
  arr.push(...head);
}
function _df(R: _Bits, sk: _Bits): _Bits {
  const er = _dperm(R, _DE);
  const x  = _dxor(er, sk);
  const s: _Bits = [];
  for (let b = 0; b < 8; b++) {
    const six = x.slice(b * 6, b * 6 + 6);
    const row = (six[0] << 1) | six[5];
    const col = (six[1] << 3) | (six[2] << 2) | (six[3] << 1) | six[4];
    const val = _DS[b][row * 16 + col];
    for (let k = 3; k >= 0; k--) s.push((val >> k) & 1);
  }
  return _dperm(s, _DP);
}

function desEncrypt(block: Buffer, key: Buffer): Buffer {
  // Key schedule
  const keyBits = _bufToBits(key);
  const kp = _dperm(keyBits, _DPC1); // 56 bits
  const C = kp.slice(0, 28);
  const D = kp.slice(28, 56);
  const subkeys: _Bits[] = [];
  for (let i = 0; i < 16; i++) {
    _drotl(C, _DSHIFTS[i]);
    _drotl(D, _DSHIFTS[i]);
    subkeys.push(_dperm([...C, ...D], _DPC2));
  }
  // Encrypt
  const ip = _dperm(_bufToBits(block), _DIP);
  let L = ip.slice(0, 32), R = ip.slice(32, 64);
  for (let i = 0; i < 16; i++) {
    const tmp = R;
    R = _dxor(L, _df(R, subkeys[i]));
    L = tmp;
  }
  return _bitsToBuf(_dperm([...R, ...L], _DFP));
}
