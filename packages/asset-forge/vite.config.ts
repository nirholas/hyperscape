import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import compression from 'vite-plugin-compression'

// https://vite.dev/config/
export default defineConfig({
  publicDir: 'public',
  plugins: [
    react(),
    // Production compression only (gzip + brotli)
    ...(process.env.NODE_ENV === 'production' ? [
      compression({
        algorithm: 'gzip',
        ext: '.gz',
        threshold: 10240,  // Only compress files > 10KB
        deleteOriginFile: false
      }),
      compression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 10240,
        deleteOriginFile: false
      })
    ] : [])
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'three'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'react': path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime'),
      'three': path.resolve(__dirname, '../../node_modules/three')
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'three', '@react-three/fiber', '@react-three/drei'],
    exclude: ['.eslintrc.cjs', 'tailwind.config.cjs', 'postcss.config.cjs'],
    esbuildOptions: {
      resolveExtensions: ['.mjs', '.js', '.jsx', '.json', '.ts', '.tsx']
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React ecosystem (most frequently used, cache separately)
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react'
          }

          // Three.js ecosystem (large library, cache separately)
          if (id.includes('node_modules/three') ||
              id.includes('@react-three/')) {
            return 'vendor-three'
          }

          // AI/ML libraries (lazy loaded with specific features, separate chunk)
          if (id.includes('@tensorflow') ||
              id.includes('@mediapipe') ||
              id.includes('@ai-sdk')) {
            return 'vendor-ai'
          }

          // Everything else (UI libs, state management, utilities)
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        }
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,  // Keep console for production debugging
        drop_debugger: true,  // Remove debugger statements
        pure_funcs: ['console.debug', 'console.log'], // Only drop debug/log, keep error/warn
        passes: 2
      },
      format: {
        comments: false
      }
    },
    chunkSizeWarningLimit: 1000
  },
  server: {
    port: 3000,
    strictPort: false,  // Allow next available port if 3000 is taken
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      }
    }
  }
})
