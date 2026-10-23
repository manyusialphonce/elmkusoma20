
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel uses its native Next.js build output.
  // Keep standalone output for self-hosted deployments.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),

  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    unoptimized: true,
  },

  async rewrites() {
    const apiUrl =
      process.env.BACKEND_URL || "http://localhost:8080";

    const mediaUrl =
      process.env.MEDIA_URL || "http://localhost:8083";

    const realtimeUrl =
      process.env.REALTIME_URL || "http://localhost:8081";

    return [
      {
        // Media local-content endpoint
        source: "/api/v1/media/local-content",
        destination: `${mediaUrl}/api/v1/media/local-content`,
      },
      {
        // Media health endpoint
        source: "/api/v1/media/health",
        destination: `${mediaUrl}/api/v1/media/health`,
      },
      {
        // Media download endpoint
        source: "/api/v1/media/:id/download",
        destination: `${mediaUrl}/api/v1/media/:id/download`,
      },
      {
        // Preserve the /api prefix for higher-education endpoints
        source: "/api/v1/education/:path*",
        destination: `${apiUrl}/api/v1/education/:path*`,
      },
      {
        // Core service v1 endpoints
        source: "/v1/:path*",
        destination: `${apiUrl}/v1/:path*`,
      },
      {
        // API requests mapped to core service
        source: "/api/v1/:path*",
        destination: `${apiUrl}/v1/:path*`,
      },
      {
        // Realtime WebSocket service
        source: "/ws/:path*",
        destination: `${realtimeUrl}/ws/:path*`,
      },
    ];
  },

  async headers() {
    return [];
  },
};

export default withNextIntl(nextConfig);
