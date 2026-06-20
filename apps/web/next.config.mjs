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
};

export default nextConfig;
