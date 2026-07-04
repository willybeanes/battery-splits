import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.mlbstatic.com' },
      { protocol: 'https', hostname: 'img.mlbstatic.com' },
    ],
  },
  async redirects() {
    if (process.env.NEXT_PUBLIC_SITE_NAME === 'Stuff Splits') {
      return [{ source: '/', destination: '/platoon', permanent: false }]
    }
    return []
  },
};

export default nextConfig;
