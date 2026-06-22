/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @airgap/beacon-ui optionally references Node's `fs` in a browser path — stub it out.
    config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false };
    return config;
  },
};

export default nextConfig;
