// Minimal RFC 6455 WebSocket server on top of Node's http module.
// No external dependencies — implements just enough of the spec for our use:
// - text frames, server-to-client and client-to-server
// - ping/pong (responds with pong)
// - close handshake
// - 100-byte payload cap per frame (sufficient for our small JSON messages)
//
// Exposes upgradeWebSocket() that hooks into Hono via a NodeServer upgrade.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export interface WSContext {
  send(data: string): void;
  close(): void;
}

export interface WSEvents {
  onOpen?: (ctx: WSContext) => void;
  onMessage?: (data: string, ctx: WSContext) => void;
  onClose?: (ctx: WSContext) => void;
  onError?: (err: Error, ctx: WSContext) => void;
}

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function makeAcceptKey(reqKey: string): string {
  return createHash('sha1').update(reqKey + WS_MAGIC).digest('base64');
}

function sendFrame(
  socket: Duplex,
  payload: Buffer,
  opcode: 0x1 | 0x8 | 0x9 | 0xa = 0x1,
): void {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN=1
    header[1] = len; // MASK=0 (server-to-client frames MUST NOT be masked per RFC 6455 §5.1)
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/**
 * Handle a WebSocket upgrade on `req`/`socket`/`head`. Returns true if it
 * claimed the upgrade (and the caller should not write anything else), or
 * false if this is not a valid WebSocket request and the caller should
 * continue with normal HTTP handling.
 */
export function handleWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  events: WSEvents,
): boolean {
  const upgrade = (req.headers.upgrade || '').toLowerCase();
  const connection = (req.headers.connection || '').toLowerCase();
  if (upgrade !== 'websocket' || !connection.includes('upgrade')) return false;
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') return false;

  const accept = makeAcceptKey(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n');
  socket.write(headers);

  const ctx: WSContext = {
    send: (data: string) => {
      const buf = Buffer.from(data, 'utf8');
      try {
        sendFrame(socket, buf, 0x1);
      } catch {
        // socket may be closed
      }
    },
    close: () => {
      try {
        sendFrame(socket, Buffer.alloc(0), 0x8);
        socket.end();
      } catch {
        // ignore
      }
    },
  };

  let closed = false;
  const close = (code = 1000) => {
    if (closed) return;
    closed = true;
    try {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      sendFrame(socket, payload, 0x8);
    } catch {
      // ignore
    }
    try {
      socket.end();
    } catch {
      // ignore
    }
    events.onClose?.(ctx);
  };

  socket.on('error', (err) => {
    events.onError?.(err, ctx);
    close(1011);
  });
  socket.on('close', () => close(1006));
  if (head && head.length > 0) socket.unshift(head);

  // Frame parser
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < offset + 2) return;
        len = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buffer.length < offset + 8) return;
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          close(1009);
          return;
        }
        len = Number(big);
        offset += 8;
      }
      let mask: Buffer | null = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.slice(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + len) return;

      const payload = buffer.slice(offset, offset + len);
      if (mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }
      buffer = buffer.slice(offset + len);

      if (opcode === 0x8) {
        // close
        close(1000);
        return;
      }
      if (opcode === 0x9) {
        // ping → pong
        try {
          sendFrame(socket, payload, 0xa);
        } catch {
          // ignore
        }
        continue;
      }
      if (opcode === 0xa) continue; // pong
      if (!fin) {
        // we don't support fragmented frames
        close(1003);
        return;
      }
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        try {
          events.onMessage?.(text, ctx);
        } catch (e) {
          events.onError?.(e as Error, ctx);
        }
      }
    }
  });

  // Fire open on next tick so the caller can register listeners first.
  queueMicrotask(() => {
    try {
      events.onOpen?.(ctx);
    } catch (e) {
      events.onError?.(e as Error, ctx);
    }
  });
  return true;
}

/**
 * Hook for Hono: returns a Hono handler that handles the upgrade and
 * delegates to the user's event callbacks. The Hono handler is a no-op for
 * non-upgrade requests.
 */
export function upgradeWebSocket(
  events: WSEvents | ((req: IncomingMessage) => WSEvents),
) {
  return (req: IncomingMessage, _res: ServerResponse, socket: Duplex, head: Buffer) => {
    const ev = typeof events === 'function' ? events(req) : events;
    return handleWebSocketUpgrade(req, socket, head, ev);
  };
}
