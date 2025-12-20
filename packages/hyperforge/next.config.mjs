/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
    remotePatterns: [
      // Local development CDN
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
        pathname: '/**',
      },
      // Supabase Storage (HyperForge generations)
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/**',
      },
      // Specific Supabase project
      {
        protocol: 'https',
        hostname: 'vshfuoglbnbeyzmnhbxe.supabase.co',
        pathname: '/**',
      },
      // Meshy assets (temporary URLs from generation)
      {
        protocol: 'https',
        hostname: 'assets.meshy.ai',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    // NOTE: lucide-react removed from optimizePackageImports because its 'Map' icon
    // conflicts with the native JavaScript Map constructor due to webpack barrel optimization
    optimizePackageImports: [
      '@react-three/fiber',
      '@react-three/drei',
      '@xyflow/react',
      'framer-motion',
      'three',
      'zustand',
    ],
  },
};

export default nextConfig;
