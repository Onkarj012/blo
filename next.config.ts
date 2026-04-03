import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow phone access for development
  allowedDevOrigins: ["192.168.1.97"],

  // Remove better-sqlite3 since we're using Convex now
  // Allow external access from phone
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Cookie" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
    ];
  },
  // Allow connections from any host (for phone access)
  devIndicators: false,
};

export default nextConfig;
