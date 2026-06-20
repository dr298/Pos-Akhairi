/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Hoisted monorepo: tell Turbopack to look for next/ in the workspace root
  turbopack: { root: '/repo' },
};
export default nextConfig;
