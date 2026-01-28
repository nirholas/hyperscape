#!/bin/bash
# Bake LOD1 models for all vegetation and resources
#
# Pipeline:
#   1. Decompress meshopt-compressed GLBs (gltf-transform)
#   2. Bake LOD1 models (Blender)
#   3. Compress all LOD1 files with meshopt (gltf-transform)
#
# Usage:
#   ./scripts/bake-lod.sh                 # Bake all LODs
#   ./scripts/bake-lod.sh --dry-run       # Preview what would be done
#   ./scripts/bake-lod.sh --verbose       # Show detailed progress
#   ./scripts/bake-lod.sh --skip-compress # Skip meshopt compression
#
# Requirements:
#   - Blender 3.0+ installed (macOS: brew install blender)
#   - gltf-transform (npx gltf-transform)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEMP_DIR="$PROJECT_ROOT/.lod-temp"
SKIP_COMPRESS=false

# Parse arguments
for arg in "$@"; do
    if [ "$arg" == "--skip-compress" ]; then
        SKIP_COMPRESS=true
    fi
done

# Find Blender
if [ -n "$BLENDER_PATH" ]; then
    BLENDER="$BLENDER_PATH"
elif command -v blender &> /dev/null; then
    BLENDER="blender"
elif [ -f "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
else
    echo "Error: Blender not found. Install it or set BLENDER_PATH"
    echo "  macOS: brew install blender"
    echo "  Or download from https://blender.org"
    exit 1
fi

echo "============================================================"
echo "LOD Baking Pipeline"
echo "============================================================"
echo "Blender: $BLENDER"
echo ""

# Step 1: Decompress meshopt-compressed files
echo "============================================================"
echo "Step 1: Decompress meshopt-compressed GLBs"
echo "============================================================"

mkdir -p "$TEMP_DIR"
DECOMPRESSED_COUNT=0

# Find all GLB files that might be meshopt compressed (in assets/ and packages/server/world/assets/)
for glb in $(find "$PROJECT_ROOT/assets" "$PROJECT_ROOT/packages/server/world/assets" -name "*.glb" ! -name "*_lod1.glb" 2>/dev/null); do
    # Check if file uses meshopt compression by looking for the extension in the file
    if grep -q "EXT_meshopt_compression" "$glb" 2>/dev/null; then
        rel_path="${glb#$PROJECT_ROOT/}"
        temp_path="$TEMP_DIR/${rel_path}"
        mkdir -p "$(dirname "$temp_path")"
        
        echo "  Decompressing: $rel_path"
        # Use gltf-transform copy to decompress meshopt
        npx gltf-transform copy "$glb" "$temp_path" 2>&1 | grep -v "^npm warn"
        DECOMPRESSED_COUNT=$((DECOMPRESSED_COUNT + 1))
    fi
done

echo "  Decompressed $DECOMPRESSED_COUNT meshopt files"
echo ""

# Step 2: Run Blender LOD baking
echo "============================================================"
echo "Step 2: Bake LOD1 models with Blender"
echo "============================================================"

# If we have temp files, update the input dirs to include temp
if [ $DECOMPRESSED_COUNT -gt 0 ]; then
    export LOD_TEMP_DIR="$TEMP_DIR"
fi

"$BLENDER" --background --python "$SCRIPT_DIR/bake-lod.py" -- "$@"

echo ""

# Step 3: Copy LOD1 files from temp back to assets (for meshopt files)
if [ $DECOMPRESSED_COUNT -gt 0 ]; then
    echo "============================================================"
    echo "Step 3: Copy LOD1 files from temp directory"
    echo "============================================================"
    
    COPIED=0
    for lod1 in $(find "$TEMP_DIR" -name "*_lod1.glb" 2>/dev/null); do
        rel_path="${lod1#$TEMP_DIR/}"
        dest_path="$PROJECT_ROOT/$rel_path"
        mkdir -p "$(dirname "$dest_path")"
        cp "$lod1" "$dest_path"
        echo "  Copied: $rel_path"
        COPIED=$((COPIED + 1))
    done
    echo "  Copied $COPIED LOD1 files"
    echo ""
fi

# Step 4: Compress all LOD1 files with meshopt
if [ "$SKIP_COMPRESS" = false ]; then
    echo "============================================================"
    echo "Step 4: Compress LOD1 files with meshopt"
    echo "============================================================"
    
    COMPRESSED=0
    for lod1 in $(find "$PROJECT_ROOT/assets" -name "*_lod1.glb" 2>/dev/null); do
        rel_path="${lod1#$PROJECT_ROOT/}"
        echo "  Compressing: $rel_path"
        
        # Create temp file for compression
        temp_compressed="${lod1}.tmp"
        
        # Apply meshopt compression + dedup + quantization
        npx gltf-transform optimize "$lod1" "$temp_compressed" \
            --compress meshopt \
            --texture-compress webp \
            --simplify-error 0.001 \
            2>/dev/null || {
            # If optimize fails, just copy original
            cp "$lod1" "$temp_compressed"
        }
        
        # Replace original with compressed
        mv "$temp_compressed" "$lod1"
        COMPRESSED=$((COMPRESSED + 1))
    done
    echo "  Compressed $COMPRESSED LOD1 files"
    echo ""
fi

# Cleanup temp directory
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# Update manifests
echo "============================================================"
echo "Step 5: Update manifests with LOD1 paths"
echo "============================================================"
node "$SCRIPT_DIR/update-lod-manifests.mjs"

echo ""
echo "============================================================"
echo "LOD Baking Complete!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Verify the generated _lod1.glb files in assets/"
echo "  2. Run: bun run build"
echo "  3. Deploy assets to CDN: ./scripts/sync-r2-assets.mjs"
