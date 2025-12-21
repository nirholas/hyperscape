# HyperForge

AI-powered content creation studio for Hyperscape. Generate 3D models, audio, images, and game content with AI—then test them in-game with one click.

## ✨ Features

### 3D Asset Generation
- **Text-to-3D**: Generate 3D models from text prompts (Meshy API)
- **Image-to-3D**: Convert concept art to 3D models
- **VRM Conversion**: Convert GLB models to VRM for avatars
- **Mesh Quality Control**: Polycount presets optimized for 60fps gameplay (500-10K polys)
- **One-Click Game Testing**: Export → Spawn → Open Game in one button

### Content Generation
- **NPC Generator**: Create NPC profiles with AI personalities
- **Quest Generator**: Full quest chains with objectives and rewards
- **Dialogue Trees**: React Flow-based visual dialogue editor
- **Area Generator**: Generate world areas with lore and NPCs
- **Item Generator**: Generate items with stats and descriptions

### Audio Generation
- **Voice TTS**: Generate NPC voices with ElevenLabs
- **Sound Effects**: AI-generated game SFX
- **Music**: Background music generation

### Image Generation
- **Concept Art**: AI concept art for characters and scenes
- **Sprites**: 2D game sprites and icons
- **Textures**: Seamless tileable textures

### Structure Studio
- **Modular Building**: Generate walls, doors, windows, floors, and roofs with AI
- **Piece Placement**: Snap-to-grid 3D editor for combining pieces into buildings
- **Building Baking**: Combine pieces into optimized single-mesh buildings
- **Town Builder**: Arrange buildings into town layouts
- **Material Presets**: Stone, wood, marble, and more material options
- **Polycount Control**: Optimize pieces for game performance

### Developer Experience
- **Command Palette** (`Ctrl+P`): Quick access to all actions
- **Prompt Vault**: Save and reuse Hyperscape-optimized prompts
- **Asset Library**: Browse CDN, local, and generated assets
- **Sync Status**: See which assets are In Game / Exported / Draft
- **Test in Game**: One-click spawn at any location

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **3D**: React Three Fiber + Drei
- **AI**: Vercel AI Gateway (via AI SDK)
- **Database**: SQLite with Drizzle ORM
- **Styling**: Tailwind CSS with OKLCH design tokens
- **State**: Zustand (planned)

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment (copy and edit .env.example)
cp .env.example .env.local

# 3. Add your API keys to .env.local:
#    - MESHY_API_KEY (required for 3D generation)
#    - AI_GATEWAY_API_KEY (required for AI features)
#    - ELEVENLABS_API_KEY (optional, for audio)

# 4. Initialize database
bun run db:push

# 5. Start development server
bun run dev
```

Open `http://localhost:3500` and press `Ctrl+P` to see the command palette!

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Open Command Palette |
| `Ctrl+G` | Quick Generate |
| `Escape` | Close modals/panels |

## Setup

## Environment Variables

- `NEXT_PUBLIC_CDN_URL`: Game CDN URL (default: `http://localhost:8080`)
- `AI_GATEWAY_API_KEY`: Vercel AI Gateway API key (required)
- `MESHY_API_KEY`: Meshy API key for 3D generation (required)
- `DATABASE_URL`: SQLite database path (default: `file:./hyperforge.db`)

## Architecture

### AI Gateway Integration

HyperForge uses Vercel AI Gateway for all AI model inference:

- **Text Generation**: Uses `provider/model` format (e.g., `anthropic/claude-sonnet-4`)
- **Image Generation**: Supports OpenAI DALL-E 3 and Google Imagen 3
- **Automatic Routing**: AI SDK automatically uses AI Gateway when it detects `provider/model` format

Example:
```typescript
import { generateText } from 'ai';
import { gateway } from 'ai';

const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4'),
  prompt: 'Generate a game asset description',
});
```

### CDN Integration

Loads assets from the same CDN the game uses:
- `/manifests/items.json`
- `/manifests/npcs.json`
- `/manifests/resources.json`

Assets are cached in-memory with 5-minute TTL.

### Meshy 3D Pipeline

HyperForge uses the Meshy API for AI-powered 3D model generation, optimized for Three.js web MMO assets.

**Generation Workflows:**
- **Text-to-3D**: Generate 3D models from text prompts (two-stage: preview → refine)
- **Image-to-3D**: Convert images to 3D models (single-stage)
- **Retexture**: Apply new textures to existing models
- **Rigging**: Add skeleton and basic animations to characters
- **Task Polling**: Automatic status polling until completion

**Mesh Control:**
- **Topology**: Triangle (GPU-ready) or Quad (artist-friendly)
- **Polycount**: Configurable target polygon count with asset-class presets
- **PBR Textures**: Optional normal, metallic, roughness maps

**Asset Class Presets** (optimized for 60fps RuneScape-style MMO):
| Asset Class | Polycount Range | Default | Notes |
|-------------|-----------------|---------|-------|
| Small Props | 200 - 1,000 | 500 | Coins, potions, tools |
| Medium Props | 500 - 3,000 | 1,500 | Weapons, furniture |
| Large Props | 1,000 - 5,000 | 2,500 | Trees, large objects |
| NPC Characters | 3,000 - 10,000 | 5,000 | Ideally ≤5K for performance |
| Small Buildings | 2,000 - 8,000 | 4,000 | Houses, shops |
| Large Structures | 4,000 - 15,000 | 8,000 | Castles, dungeons |

**Three.js Best Practices:**
- Keep individual meshes < 100,000 triangles
- Use LOD (Level of Detail) for distant objects
- Instance frequently repeated objects (trees, rocks, etc.)
- Bake details into normal/roughness/AO maps
- Export as GLB with triangulated meshes

## Project Structure

```
packages/hyperforge/
├── lib/
│   ├── ai/          # AI Gateway integration
│   ├── meshy/       # Meshy 3D generation
│   ├── cdn/         # CDN asset loading
│   └── db/          # Database schema & client
├── src/
│   ├── app/         # Next.js App Router
│   ├── components/ # React components
│   ├── hooks/       # React hooks
│   └── types/       # TypeScript types
└── public/          # Static assets
```

## Development

### Database

```bash
# Generate migrations
bun run db:generate

# Push schema changes
bun run db:push

# Open Drizzle Studio
bun run db:studio
```

### Building

```bash
# Production build
bun run build

# Start production server
bun run start
```

## Status

### ✅ Complete
- Meshy Text-to-3D and Image-to-3D pipelines
- VRM conversion pipeline
- Asset library with CDN/Local/Supabase sources
- Asset filtering, search, and categories
- 3D model viewer with GLTF/VRM loading
- Generation history tracking
- One-click game testing workflow
- Command palette with prompt vault
- Content generators (NPC, Quest, Area, Item)
- Audio generation (Voice, SFX, Music)
- Image generation (Concept, Sprites, Textures)

### 🚧 In Progress
- Armor/Equipment fitting (partial implementation)
- Variant/Retexture pipeline
- Animation frame extraction for sprites

### 📋 Planned
- Visual world editor (drag & drop asset placement)
- Batch generation queue with status dashboard
- Asset versioning and history

## References

### AI & Generation
- [Vercel AI Gateway Docs](https://vercel.com/docs/ai-gateway)
- [AI SDK Docs](https://sdk.vercel.ai/docs)

### Meshy API Documentation
- [Meshy API Overview](https://www.meshy.ai/api) - High-level API overview
- [Image-to-3D API](https://docs.meshy.ai/en/api/image-to-3d) - Convert images to 3D models
- [Text-to-3D API](https://docs.meshy.ai/api/text-to-3d) - Generate 3D from text prompts
- [Quickstart Guide](https://docs.meshy.ai/en/api/quick-start) - API keys and authentication
- [API Changelog](https://docs.meshy.ai/en/api/changelog) - Latest features and updates
- [Multi-Image API (Fal.ai)](https://fal.ai/models/fal-ai/meshy/v5/multi-image-to-3d/api) - Multi-view reconstruction

### Performance Resources
- [Three.js Documentation](https://threejs.org/docs/)
- [glTF Optimization](https://github.com/KhronosGroup/glTF-Tutorials)

