const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});
const { networkInterfaces } = require("node:os");

const localDevOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter(({ internal }) => !internal)
  .map(({ address }) => address);

/** @type {import('next').NextConfig} */

const nextConfig = {
  allowedDevOrigins: localDevOrigins,
  devIndicators: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/metadata/assets/*": [
      "./node_modules/@6over3/zeroperl-ts/dist/esm/zeroperl.wasm",
      "./node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
      "./node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
    ],
  },
  reactStrictMode: true,
  transpilePackages: ["highlight.js"],
  experimental: {
    optimizePackageImports: ["shiki"],
  },
  images: {
    remotePatterns: [],
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
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^node:fs\/promises$/,
        }),
      );
    }

    return config;
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
