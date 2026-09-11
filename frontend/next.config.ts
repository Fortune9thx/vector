import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  async headers() {
    // Every write in this app is a real wallet-signed transaction
    // (create_bounty / fund_pool / submit_disclosure / triage /
    // challenge_duplicate / resolve_duplicate / finalize_payout /
    // claim_payout / expire_disclosure / close_bounty /
    // withdraw_unused_pool / withdraw_fees) triggered from a button click --
    // frame-ancestors 'none' stops the page from being embedded in a
    // hidden/disguised iframe on another site for a clickjacking attempt
    // against those buttons. The rest are standard baseline hardening;
    // Next/Vercel set none of these by default.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-eval' is required by the real wagmi/viem/
              // WalletConnect stack at runtime (confirmed against prior
              // GenLayer + RainbowKit deploys on this stack) -- blocking it
              // breaks wallet connection entirely for a directive that
              // still blocks the thing that actually matters: loading a
              // *foreign* script from a different origin.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // wagmi's default connector set transitively pulls in the Coinbase
    // Base Account connector -> @coinbase/cdp-sdk -> optional @x402/*
    // payment-protocol packages that aren't installed and aren't needed --
    // Vector never uses x402 payments, only GenLayer contract calls.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    // @metamask/sdk's React Native storage backend and pino's optional
    // pretty-printer transport are both unreachable in a browser/Next.js
    // build -- ignore rather than leave harmless "module not found"
    // warnings in every build log.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@react-native-async-storage\/async-storage$/ })
    );
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^pino-pretty$/ }));
    return config;
  },
};

export default nextConfig;
