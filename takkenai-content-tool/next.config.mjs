/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverComponentsExternalPackages: [
      "@anthropic-ai/sdk",
      "@resvg/resvg-js",
      "satori",
    ],
  },
};
export default nextConfig;
