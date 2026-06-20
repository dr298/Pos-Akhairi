import path from 'node:path';
import { existsSync } from 'node:fs';

/** @type {import('next').NextConfig} */
const repoRoot = '/repo';
const hasRepoRoot = existsSync(repoRoot);

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // Hoisted monorepo: tell Turbopack to look for next/ in the workspace root.
  // Only enable this when /repo actually exists (Docker build); otherwise the
  // project runs from a regular clone and uses the default cwd.
  ...(hasRepoRoot ? { turbopack: { root: repoRoot } } : {}),
  // Proxy /api/* from the browser → API container. Browser sees same-origin
  // (pos.akhairi.com/api/login), Next.js forwards server-side to
  // the API container. The host is read from API_PROXY_TARGET (defaults to
  // the docker service name `pos-api` for the standalone container; for
  // docker compose, override to `api`). Cookie flows naturally (no CORS).
  async rewrites() {
    const apiHost = process.env.API_PROXY_TARGET || 'pos-api:8787';
    return [
      {
        source: '/api/:path*',
        destination: `http://${apiHost}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
