#!/usr/bin/env node

/**
 * DEPRECATED: Image Server (Standalone)
 *
 * This standalone image server has been MERGED into the main Express API server (server/api.mjs).
 * The API server now serves temp-images at /temp-images endpoint on port 3004.
 *
 * This file is kept for reference only and should NOT be used in production.
 *
 * Migration details:
 * - Old: Separate server on port 8081 serving /temp-images
 * - New: Integrated into API server on port 3004 at /temp-images
 * - Updated: env.example, package.json scripts, server/api.mjs
 *
 * Original functionality:
 * Serves images from temp-images directory for Meshy AI to access
 */

import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.join(__dirname, '..')

const app = express()
const PORT = process.env.IMAGE_SERVER_PORT || 8081

// Ensure temp-images directory exists
await fs.mkdir(path.join(ROOT_DIR, 'temp-images'), { recursive: true })

// Serve images from temp-images directory
app.use(express.static(path.join(ROOT_DIR, 'temp-images')))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Image server is running' })
})

// List available images
app.get('/list', async (req, res) => {
  try {
    const files = await fs.readdir(path.join(ROOT_DIR, 'temp-images'))
    const images = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
    res.json({ images })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`🖼️  Image server running on http://localhost:${PORT}`)
  console.log(`📁 Serving images from: ${path.join(ROOT_DIR, 'temp-images')}`)
  console.log(`🔍 Health check: http://localhost:${PORT}/health`)
  console.log(`📋 List images: http://localhost:${PORT}/list`)
}) 