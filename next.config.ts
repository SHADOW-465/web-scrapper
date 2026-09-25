import type { NextConfig } from "next";

const config: NextConfig = {
  // Chromium ships as a compressed binary inside @sparticuz/chromium; it must be
  // left out of bundling and its bin/ folder traced into the functions that launch it.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/@sparticuz/chromium/bin/**", "./lib/extractor.js"],
    "/api/crawl": ["./node_modules/@sparticuz/chromium/bin/**", "./lib/extractor.js"],
  },
  outputFileTracingExcludes: {
    "*": ["./legacy/**", "./data/**", "./exports/**", "./docs/**"],
  },
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
