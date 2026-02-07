/** @type {import('next').NextConfig} */
const nextConfig = {
  // Memory optimization for development
  onDemandEntries: {
    maxInactiveAge: 15 * 1000,
    pagesBufferLength: 3,
  },

  // Standalone output for VPS Docker deployment
  output: "standalone",

  env: {
    NEXT_BUILD_TARGET: "backend",
  },

  // API routes enabled for backend
  experimental: {
    serverActions: {
      allowedOrigins: ["elongoat.io", "api.elongoat.io"],
    },
    serverComponentsExternalPackages: ["drizzle-kit", "esbuild", "pg-native"],
  },

  // Bundle optimization
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
    },
  },

  // Compiler optimizations for production
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

export default nextConfig;
