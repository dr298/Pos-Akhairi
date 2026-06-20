// Sprint 7.5 — Prometheus metrics (in-process).
// Counter, gauge, histogram primitives. No external dep.
// For multi-instance deploy, swap with prom-client; same shape.
import { Writable } from 'stream';

type Counter = { name: string; help: string; values: Map<string, number> };
type Gauge = { name: string; help: string; values: Map<string, number> };
type Histogram = {
  name: string;
  help: string;
  buckets: number[];
  values: Map<string, number[]>; // sorted bucket counts
  sums: Map<string, number>;
  counts: Map<string, number>;
};

const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();
const histograms = new Map<string, Histogram>();

function getOrCreate<T>(map: Map<string, T>, key: string, factory: () => T): T {
  let v = map.get(key);
  if (!v) {
    v = factory();
    map.set(key, v);
  }
  return v;
}

function labelKey(labels?: Record<string, string | number>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`)
    .join(',');
}

export function incCounter(name: string, help: string, labels?: Record<string, string | number>, value = 1) {
  const c = getOrCreate(counters, name, () => ({ name, help, values: new Map() }));
  const k = labelKey(labels);
  c.values.set(k, (c.values.get(k) ?? 0) + value);
}

export function setGauge(name: string, help: string, value: number, labels?: Record<string, string | number>) {
  const g = getOrCreate(gauges, name, () => ({ name, help, values: new Map() }));
  g.values.set(labelKey(labels), value);
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function observeHistogram(
  name: string,
  help: string,
  value: number,
  labels?: Record<string, string | number>,
  buckets = DEFAULT_BUCKETS,
) {
  const h = getOrCreate(histograms, name, () => ({
    name,
    help,
    buckets,
    values: new Map(),
    sums: new Map(),
    counts: new Map(),
  }));
  const k = labelKey(labels);
  let arr = h.values.get(k);
  if (!arr) {
    arr = new Array(buckets.length).fill(0);
    h.values.set(k, arr);
  }
  for (let i = 0; i < buckets.length; i++) {
    if (value <= buckets[i]) {
      arr[i]++;
    }
  }
  h.sums.set(k, (h.sums.get(k) ?? 0) + value);
  h.counts.set(k, (h.counts.get(k) ?? 0) + 1);
}

export function renderPrometheus(): string {
  const out: string[] = [];

  for (const c of counters.values()) {
    out.push(`# HELP ${c.name} ${c.help}`);
    out.push(`# TYPE ${c.name} counter`);
    for (const [k, v] of c.values) {
      out.push(k ? `${c.name}{${k}} ${v}` : `${c.name} ${v}`);
    }
  }

  for (const g of gauges.values()) {
    out.push(`# HELP ${g.name} ${g.help}`);
    out.push(`# TYPE ${g.name} gauge`);
    for (const [k, v] of g.values) {
      out.push(k ? `${g.name}{${k}} ${v}` : `${g.name} ${v}`);
    }
  }

  for (const h of histograms.values()) {
    out.push(`# HELP ${h.name} ${h.help}`);
    out.push(`# TYPE ${h.name} histogram`);
    for (const [k, arr] of h.values) {
      const prefix = k ? `${h.name}{${k},le="` : `${h.name}_bucket{le="`;
      const closing = k ? `}` : `}`;
      h.buckets.forEach((b, i) => {
        out.push(`${prefix}${b}${closing} ${arr[i]}`);
      });
      out.push(
        k
          ? `${h.name}_bucket{${k},le="+Inf"} ${h.counts.get(k) ?? 0}`
          : `${h.name}_bucket{le="+Inf"} ${h.counts.get(k) ?? 0}`,
      );
      out.push(k ? `${h.name}_sum{${k}} ${h.sums.get(k) ?? 0}` : `${h.name}_sum ${h.sums.get(k) ?? 0}`);
      out.push(
        k ? `${h.name}_count{${k}} ${h.counts.get(k) ?? 0}` : `${h.name}_count ${h.counts.get(k) ?? 0}`,
      );
    }
  }

  return out.join('\n') + '\n';
}

// Convenience: hook into a Hono app to auto-instrument.
export function metricsMiddleware() {
  return async (c: any, next: any) => {
    const start = performance.now();
    await next();
    const ms = performance.now() - start;
    const route = c.req.path;
    const method = c.req.method;
    const status = String(c.res.status);
    observeHistogram(
      'http_request_duration_seconds',
      'HTTP request duration in seconds',
      ms / 1000,
      { method, route, status },
    );
    incCounter('http_requests_total', 'Total HTTP requests', { method, route, status });
  };
}

// Suppress unused warning for Writable (kept for future stream export)
void Writable;
