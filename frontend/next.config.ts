import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow the bounded import deadline and filesystem cleanup to complete.
  experimental: { proxyTimeout: 90_000 },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.REPO_SURGEON_API_ORIGIN ?? 'http://127.0.0.1:8000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
