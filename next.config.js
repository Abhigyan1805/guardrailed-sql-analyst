/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['@electric-sql/pglite'] },
};
module.exports = nextConfig;
