#!/bin/bash
#
# Avatar Optimization Pipeline
#
# Optimizes VRM avatar files with:
# - Textures: 2048px color, 1024px normal, no metallic/roughness/AO
# - LOD0: 30k triangles (main gameplay)
# - LOD1: 10k triangles (distant)
# - LOD2: 2k triangles (very distant / impostor base)
#
# Pipeline:
#   1. Run Blender optimization script (decimation + texture optimization)
#   2. Compress outputs with gltf-transform meshopt
#
# Usage:
#   ./scripts/optimize-avatars.sh                    # Optimize all avatars
#   ./scripts/optimize-avatars.sh --dry-run          # Preview what would be done
#   ./scripts/optimize-avatars.sh --single file.vrm  # Process single file
#   ./scripts/optimize-avatars.sh --skip-compress    # Skip meshopt compression
#
# Requirements:
#   - Blender 3.0+ installed (macOS: brew install blender)
#   - VRM addon for Blender (recommended): https://vrm-addon-for-blender.info/en/
#   - gltf-transform (npx gltf-transform) for compression
#
# Without VRM addon, the script falls back to GLTF export which loses VRM metadata.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AVATARS_DIR="$PROJECT_ROOT/packages/server/world/assets/avatars"
SKIP_COMPRESS=false
DRY_RUN=false
SINGLE_FILE=""
EXTRA_ARGS=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-compress)
            SKIP_COMPRESS=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            EXTRA_ARGS="$EXTRA_ARGS --dry-run"
            shift
            ;;
        --single)
            SINGLE_FILE="$2"
            EXTRA_ARGS="$EXTRA_ARGS --single $2"
            shift 2
            ;;
        --verbose)
            EXTRA_ARGS="$EXTRA_ARGS --verbose"
            shift
            ;;
        --lod-only)
            EXTRA_ARGS="$EXTRA_ARGS --lod-only"
            shift
            ;;
        --texture-only)
            EXTRA_ARGS="$EXTRA_ARGS --texture-only"
            shift
            ;;
        --input)
            AVATARS_DIR="$PROJECT_ROOT/$2"
            EXTRA_ARGS="$EXTRA_ARGS --input $2"
            shift 2
            ;;
        --output)
            EXTRA_ARGS="$EXTRA_ARGS --output $2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Find Blender
if [ -n "$BLENDER_PATH" ]; then
    BLENDER="$BLENDER_PATH"
elif command -v blender &> /dev/null; then
    BLENDER="blender"
elif [ -f "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
else
    echo -e "${RED}Error: Blender not found. Install it or set BLENDER_PATH${NC}"
    echo "  macOS: brew install blender"
    echo "  Or download from https://blender.org"
    exit 1
fi

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}          VRM Avatar Optimization Pipeline${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""
echo -e "Blender:     $BLENDER"
echo -e "Input:       $AVATARS_DIR"
echo -e "Dry run:     $DRY_RUN"
echo -e "Skip compress: $SKIP_COMPRESS"
[ -n "$SINGLE_FILE" ] && echo -e "Single file: $SINGLE_FILE"
echo ""

# Check if avatars directory exists
if [ ! -d "$AVATARS_DIR" ]; then
    echo -e "${RED}Error: Avatars directory not found: $AVATARS_DIR${NC}"
    exit 1
fi

# Count VRM files
if [ -n "$SINGLE_FILE" ]; then
    VRM_COUNT=1
else
    VRM_COUNT=$(find "$AVATARS_DIR" -maxdepth 1 -name "*.vrm" ! -name "*_optimized*" ! -name "*_lod1*" ! -name "*_lod2*" 2>/dev/null | wc -l | tr -d ' ')
fi

echo -e "${GREEN}Found $VRM_COUNT VRM files to process${NC}"
echo ""

# Step 1: Run Blender optimization
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}Step 1: Blender Optimization (Decimate + Texture)${NC}"
echo -e "${BLUE}============================================================${NC}"

"$BLENDER" --background --python "$SCRIPT_DIR/optimize-avatars.py" -- $EXTRA_ARGS

echo ""

# Step 2: Compress with meshopt (if not dry-run and not skipped)
if [ "$DRY_RUN" = false ] && [ "$SKIP_COMPRESS" = false ]; then
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}Step 2: Compress with meshopt${NC}"
    echo -e "${BLUE}============================================================${NC}"
    
    # Find all processed VRM files (including new LOD files)
    COMPRESSED=0
    
    for vrm in "$AVATARS_DIR"/*.vrm; do
        [ -e "$vrm" ] || continue
        
        filename=$(basename "$vrm")
        
        # Skip original high-poly files (only process our output files)
        # Our outputs are: avatar.vrm (optimized), avatar_lod1.vrm, avatar_lod2.vrm
        if [[ ! "$filename" =~ _lod[12]\.vrm$ ]]; then
            # Check if this is likely our output by checking file size or triangles
            # For now, compress all non-LOD VRM files
            :
        fi
        
        echo -e "  Compressing: $filename"
        
        # Create temp file for compression
        temp_compressed="${vrm}.tmp"
        
        # Apply meshopt compression + texture optimization
        if npx gltf-transform optimize "$vrm" "$temp_compressed" \
            --compress meshopt \
            --texture-compress webp \
            2>/dev/null; then
            mv "$temp_compressed" "$vrm"
            COMPRESSED=$((COMPRESSED + 1))
        else
            echo -e "${YELLOW}    Warning: meshopt compression failed, keeping original${NC}"
            rm -f "$temp_compressed"
        fi
    done
    
    echo -e "${GREEN}  Compressed $COMPRESSED files${NC}"
    echo ""
fi

# Summary
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}                    Summary${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}DRY RUN - No files were modified${NC}"
else
    echo -e "${GREEN}Avatar optimization complete!${NC}"
    echo ""
    echo "Output files:"
    echo "  LOD0 (30k tris): avatar.vrm"
    echo "  LOD1 (10k tris): avatar_lod1.vrm"
    echo "  LOD2 (2k tris):  avatar_lod2.vrm"
    echo ""
    echo "Next steps:"
    echo "  1. Verify the optimized files in $AVATARS_DIR"
    echo "  2. Update avatars.ts to reference LOD files if needed"
    echo "  3. Deploy assets to CDN: ./scripts/sync-r2-assets.mjs"
fi

echo ""
