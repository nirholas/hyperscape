/**
 * API Route: Audio Assets
 * Load audio assets following the storage priority pattern:
 * 
 * Storage sources (in priority order):
 * 1. CDN music.json manifest (production game music)
 * 2. Supabase audio-generations bucket (HyperForge generations)
 * 3. Local filesystem assets/audio (legacy fallback)
 * 
 * This route returns audio files only - 3D models go through /api/assets/*
 */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  listAudioAssets as listSupabaseAudio,
  isSupabaseConfigured,
} from "@/lib/storage/supabase-storage";
import { loadCDNAssets } from "@/lib/cdn/loader";
import { logger } from "@/lib/utils";

const log = logger.child("API:audio:assets");

interface AudioAsset {
  id: string;
  filename: string;
  type: "voice" | "sfx" | "music";
  url: string;
  size: number;
  createdAt: string;
  source: "cdn" | "supabase" | "local";
  metadata?: {
    text?: string;
    voicePreset?: string;
    prompt?: string;
    category?: string;
    npcId?: string;
    dialogueNodeId?: string;
    // CDN music metadata
    musicType?: string;
    mood?: string;
    description?: string;
  };
}

/**
 * GET /api/audio/assets
 * Returns audio assets from CDN → Supabase → local filesystem
 */
export async function GET() {
  try {
    const assets: AudioAsset[] = [];
    const loadedIds = new Set<string>();
    const cdnUrl = process.env.CDN_URL || process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3500";
    
    // 1. Load from CDN music.json manifest (production game music)
    try {
      const cdnAssets = await loadCDNAssets();
      const musicAssets = cdnAssets.filter(
        (asset) => asset.category === "music" || asset.category === "audio"
      );
      
      for (const music of musicAssets) {
        loadedIds.add(music.id);
        
        // Resolve the audio URL from CDN
        const audioUrl = music.modelPath.startsWith("asset://")
          ? music.modelPath.replace("asset://", `${cdnUrl}/`)
          : `${cdnUrl}/${music.modelPath}`;
        
        assets.push({
          id: music.id,
          filename: path.basename(music.modelPath),
          type: "music",
          url: audioUrl,
          size: 0, // CDN doesn't provide size info
          createdAt: new Date().toISOString(),
          source: "cdn",
          metadata: {
            musicType: music.type,
            category: music.subtype,
            description: music.description,
          },
        });
      }
      log.info("Loaded music tracks from CDN", { count: musicAssets.length });
    } catch (error) {
      log.warn("Failed to load from CDN", { error });
    }
    
    // 2. Load from Supabase audio-generations bucket (HyperForge generations)
    if (isSupabaseConfigured()) {
      try {
        const supabaseAudio = await listSupabaseAudio();
        for (const audio of supabaseAudio) {
          // Skip if already loaded from CDN
          if (loadedIds.has(audio.id)) continue;
          loadedIds.add(audio.id);
          
          assets.push({
            id: audio.id,
            filename: audio.filename,
            type: audio.type,
            url: audio.url,
            size: audio.size || 0,
            createdAt: audio.createdAt || new Date().toISOString(),
            source: "supabase",
          });
        }
        log.info("Loaded audio files from Supabase", { count: supabaseAudio.length });
      } catch (error) {
        log.warn("Failed to load from Supabase", { error });
      }
    }
    
    // 2. Load from local filesystem (fallback)
    const assetsDir = process.env.HYPERFORGE_ASSETS_DIR || path.join(process.cwd(), "assets");
    const audioDir = path.join(assetsDir, "audio");
    
    // Audio types and their directories
    const audioTypes: Array<{ folder: string; type: AudioAsset["type"] }> = [
      { folder: "voice", type: "voice" },
      { folder: "sfx", type: "sfx" },
      { folder: "music", type: "music" },
    ];
    
    for (const { folder, type } of audioTypes) {
      const typeDir = path.join(audioDir, folder);
      
      try {
        await fs.access(typeDir);
        
        // Read files recursively (handles category subdirectories)
        const audioFiles = await readAudioFilesRecursively(typeDir);
        
        for (const { filepath, relativePath } of audioFiles) {
          const filename = path.basename(filepath);
          
          // Generate unique ID using relative path (not just filename)
          // This prevents collisions like voice/combat/attack.mp3 vs voice/dialogue/attack.mp3
          // ID format: type_subdir_filename (e.g., "voice_combat_attack" or "sfx_attack")
          const relativeDir = path.dirname(relativePath);
          const filenameWithoutExt = filename.replace(/\.[^.]+$/, "");
          const id = relativeDir !== "." 
            ? `${type}_${relativeDir.replace(/[/\\]/g, "_")}_${filenameWithoutExt}`
            : `${type}_${filenameWithoutExt}`;
          
          // Skip if already loaded from Supabase
          if (loadedIds.has(id)) continue;
          loadedIds.add(id); // Mark as loaded to prevent duplicates within local files
          
          const stats = await fs.stat(filepath);
          
          // Build URL path
          const urlPath = relativePath.replace(/\\/g, "/"); // Windows path fix
          
          assets.push({
            id,
            filename,
            type,
            url: `${apiUrl}/api/audio/file/${folder}/${urlPath}`,
            size: stats.size,
            createdAt: stats.mtime.toISOString(),
            source: "local",
            metadata: {
              category: relativeDir !== "." ? relativeDir : undefined,
            },
          });
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }
    
    // Sort by creation date, newest first
    assets.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    log.info("Returning audio assets", { count: assets.length });
    
    return NextResponse.json(assets);
  } catch (error) {
    log.error("Error loading audio assets", { error });
    return NextResponse.json(
      { error: "Failed to load audio assets" },
      { status: 500 }
    );
  }
}

/**
 * Recursively read audio files from a directory
 */
async function readAudioFilesRecursively(
  dir: string,
  basePath: string = ""
): Promise<Array<{ filepath: string; relativePath: string }>> {
  const results: Array<{ filepath: string; relativePath: string }> = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;
      
      if (entry.isDirectory()) {
        // Recurse into subdirectories
        const subResults = await readAudioFilesRecursively(fullPath, relativePath);
        results.push(...subResults);
      } else if (entry.isFile()) {
        // Check if it's an audio file
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm"].includes(ext || "")) {
          results.push({ filepath: fullPath, relativePath });
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  
  return results;
}
