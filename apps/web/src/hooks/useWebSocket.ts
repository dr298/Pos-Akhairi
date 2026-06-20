'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_URL } from '@/lib/api';

export type WSStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface WSMessage {
  type: string;
  [k: string]: unknown;
}

export interface UseWebSocketResult {
  status: WSStatus;
  send: (msg: WSMessage) => void;
  subscribe: (cb: (msg: WSMessage) => void) => () => void;
  /** Convenience: subscribe to a specific message type. Returns unsubscribe. */
  on: (type: string, cb: (msg: WSMessage) => void) => () => void;
}

/**
 * useWebSocket — single shared connection per mount. Auto-reconnects with
 * exponential backoff (1s, 2s, 4s, capped at 30s). Pauses when the tab is
 * hidden and resumes when visible.
 */
export function useWebSocket(path = '/ws'): UseWebSocketResult {
  const [status, setStatus] = useState<WSStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const subsRef = useRef<Set<(msg: WSMessage) => void>>(new Set());
  const retryRef = useRef(0);
  const closedByUserRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const subscribe = useCallback((cb: (msg: WSMessage) => void) => {
    subsRef.current.add(cb);
    return () => {
      subsRef.current.delete(cb);
    };
  }, []);

  const on = useCallback(
    (type: string, cb: (msg: WSMessage) => void) => {
      const wrapped = (msg: WSMessage) => {
        if (msg.type === type) cb(msg);
      };
      return subscribe(wrapped);
    },
    [subscribe],
  );

  const send = useCallback((msg: WSMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (typeof window === 'undefined') return;
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_URL}${path}`);
    } catch {
      setStatus('error');
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setStatus('open');
    };
    ws.onmessage = (evt) => {
      let parsed: WSMessage | null = null;
      try {
        parsed = JSON.parse(String(evt.data)) as WSMessage;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== 'string') return;
      for (const cb of subsRef.current) {
        try {
          cb(parsed);
        } catch {
          // ignore subscriber errors
        }
      }
    };
    ws.onerror = () => {
      setStatus('error');
    };
    ws.onclose = () => {
      setStatus('closed');
      if (!closedByUserRef.current) scheduleReconnect();
    };
  }, [path]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) return;
    const delay = Math.min(30000, 1000 * 2 ** retryRef.current);
    retryRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (document.hidden) return;
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    closedByUserRef.current = false;
    connect();

    const onVisibility = () => {
      if (document.hidden) return;
      // resume: try to connect if not connected
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        retryRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      closedByUserRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { status, send, subscribe, on };
}
