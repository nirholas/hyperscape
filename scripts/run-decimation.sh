#!/bin/bash
# Run the Blender vegetation decimation script
#
# Usage:
#   ./scripts/run-decimation.sh                    # Process all vegetation
#   ./scripts/run-decimation.sh --dry-run          # Preview what would be done
#   ./scripts/run-decimation.sh --in-place         # Overwrite original files
#
# Requirements:
#   - Blender 3.0+ installed
#   - macOS: brew install blender
#   - Or set BLENDER_PATH environment variable

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

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

echo "Using Blender: $BLENDER"
echo ""

# Run the decimation script
"$BLENDER" --background --python "$SCRIPT_DIR/decimate-vegetation.py" -- "$@"
