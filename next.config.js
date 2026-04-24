const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["highlight.js"],
  experimental: {
    optimizePackageImports: ["shiki"],
  },
  images: {
    remotePatterns: [
      {
        hostname: "files.raycast.com",
        protocol: "https",
      },
    ],
  },
  turbopack: {
    rules: {
      "*.svg": [
        {
          condition: { query: "?url" },
          loaders: ["url-loader"],
          as: "*.js",
        },
        {
          loaders: [
            {
              loader: "@svgr/webpack",
              options: {
                svgoConfig: {
                  plugins: [
                    {
                      name: "removeViewBox",
                      active: false,
                    },
                  ],
                },
              },
            },
          ],
          as: "*.js",
        },
      ],
      "*.inline.png": {
        loaders: ["url-loader"],
        as: "*.js",
      },
      "*.inline.jpg": {
        loaders: ["url-loader"],
        as: "*.js",
      },
      "*.inline.gif": {
        loaders: ["url-loader"],
        as: "*.js",
      },
    },
  },
  async rewrites() {
    return {
      fallback: [
        {
          source: "/:path*",
          destination: "https://go.sqiu.dev/:path*",
        },
      ],
    };
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "icon.snap.sqiu.dev",
          },
        ],
        destination: "https://snap.sqiu.dev/icon/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "icons.snap.sqiu.dev",
          },
        ],
        destination: "https://snap.sqiu.dev/icon/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // matching all API routes
        source: "/api/shorten-url",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
          },
        ],
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
