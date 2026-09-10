import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // AIGC START
  // next dev blocks /_next/webpack-hmr unless the public host is listed.
  allowedDevOrigins: ['145.241.168.101', 'localhost'],
  turbopack: {},
  webpack(config, { dev }) {
    if (dev) config.cache = false;
    return config;
  },
  // AIGC END
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
};

export default nextConfig;
