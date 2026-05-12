/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "flagcdn.com", pathname: "/**" }],
  },
  // No rewrite matching /api/**. frontend/src/app/api/[...path]/route.js handles
  // proxying so auth Set-Cookie headers survive on Vercel.
  /**
   * Dev: persistent Webpack cache can corrupt after HMR failures and cause
   * `__webpack_modules__[moduleId] is not a function` on pages like /dashboard.
   */
  webpack: (config, { dev }) => {
    if (dev) {
      /* Avoid stale chunk maps (Cannot find module './NNNN.js') after HMR / interrupted compiles. */
      config.cache = false;
      config.optimization = {
        ...config.optimization,
        moduleIds: "named",
        chunkIds: "named",
      };
    }
    return config;
  },
};

export default nextConfig;
