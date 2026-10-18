/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@electric-sql/pglite'],
    outputFileTracingIncludes: {
      '/api/**/*': ['./db/**/*', './docs/openapi.yaml', './node_modules/@electric-sql/pglite/dist/**/*'],
    },
  },
};
module.exports = nextConfig;
