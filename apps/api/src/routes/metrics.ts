// Sprint 7.5 — Prometheus /metrics endpoint.
import { Hono } from 'hono';
import { renderPrometheus } from '../middleware/metrics.js';

export const metricsRoutes = new Hono();

metricsRoutes.get('/', (c) => {
  const body = renderPrometheus();
  return c.text(body, 200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
});
