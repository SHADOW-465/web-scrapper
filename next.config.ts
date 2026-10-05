import type { NextConfig } from "next";

// Turbopack's trace misses @puppeteer/browsers/lib/browser-data in this version.
// Those modules are imported at startup, before a route can report an error.
const browserRuntimeFiles = [
  "./node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/@sparticuz/chromium/build/**/*.js",
  "./node_modules/@sparticuz/chromium/package.json",
  "./node_modules/@puppeteer/browsers/lib/**/*.js",
  "./lib/extractor.js",
];

const config: NextConfig = {
  // Chromium ships as a compressed binary inside @sparticuz/chromium; it must be
  // left out of bundling and its bin/ folder traced into the functions that launch it.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "linkedom"],
  outputFileTracingIncludes: {
    "/api/scan": browserRuntimeFiles,
    "/api/crawl": browserRuntimeFiles,
    "/api/items/sample": browserRuntimeFiles,
    "/api/items/read": browserRuntimeFiles,
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
