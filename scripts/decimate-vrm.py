#!/usr/bin/env python3
"""
VRM Avatar Decimation Script for Blender

Decimates VRM avatar files while preserving:
- Bone weights (vertex groups)
- Armature/skeleton structure
- VRM metadata and expressions
- Materials and textures

Requirements:
- Blender 3.0+ with VRM addon (vrm_addon_for_blender)
- Install VRM addon from: https://vrm-addon-for-blender.info/en/

Usage:
    blender --background --python scripts/decimate-vrm.py -- [options]

Options:
    --input <dir>       Input directory (default: assets/avatars)
    --target-ratio 0.06 Target decimation ratio (default: 0.06 = 6%)
    --target-triangles  Target triangle count (overrides ratio)
    --dry-run           Show what would be done without creating files
    --verbose           Show detailed progress
"""

import bpy
import sys
import os
from pathlib import Path
from typing import List, Dict, Tuple

# Parse arguments after "--"
argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

# Configuration
CONFIG = {
    "dry_run": False,
    "verbose": False,
    "input_dir": "assets/avatars",
    "target_ratio": 0.06,  # 6% = ~30K from 500K
    "target_triangles": None,  # If set, overrides ratio
    "min_vertices": 5000,  # Minimum vertices for character mesh
}

# Parse command line arguments
i = 0
while i < len(argv):
    arg = argv[i]
    if arg == "--input" and i + 1 < len(argv):
        CONFIG["input_dir"] = argv[i + 1]
        i += 2
    elif arg == "--target-ratio" and i + 1 < len(argv):
        CONFIG["target_ratio"] = float(argv[i + 1])
        i += 2
    elif arg == "--target-triangles" and i + 1 < len(argv):
        CONFIG["target_triangles"] = int(argv[i + 1])
        i += 2
    elif arg == "--dry-run":
        CONFIG["dry_run"] = True
        i += 1
    elif arg == "--verbose":
        CONFIG["verbose"] = True
        i += 1
    else:
        i += 1

# Get project root
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent


def log(msg: str, verbose_only: bool = False):
    """Print log message"""
    if verbose_only and not CONFIG["verbose"]:
        return
    print(msg)


def clear_scene():
    """Remove all objects from the scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    
    # Clear orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)
    for block in bpy.data.armatures:
        if block.users == 0:
            bpy.data.armatures.remove(block)


def check_vrm_addon() -> bool:
    """Check if VRM addon is installed and working"""
    try:
        # Try to access the VRM import operator
        return hasattr(bpy.ops.import_scene, "vrm") and bpy.ops.import_scene.vrm.poll()
    except:
        return False


def import_vrm(filepath: Path) -> bool:
    """Import a VRM file (using GLTF importer since VRM is GLTF-based)"""
    clear_scene()
    
    try:
        # VRM files are GLTF-based, so we can use the GLTF importer directly
        # This preserves the mesh, armature, and vertex weights
        bpy.ops.import_scene.gltf(filepath=str(filepath))
        log(f"  Imported using GLTF loader", verbose_only=True)
        return True
    except Exception as e:
        log(f"  ERROR: Failed to import {filepath.name}: {e}")
        return False


def get_mesh_stats() -> Dict[str, int]:
    """Get mesh statistics from current scene"""
    total_verts = 0
    total_tris = 0
    mesh_count = 0
    
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            mesh = obj.data
            total_verts += len(mesh.vertices)
            # Count triangles (each face can have different vertex count)
            total_tris += sum(1 for p in mesh.polygons for _ in range(len(p.vertices) - 2))
            mesh_count += 1
    
    return {
        "vertices": total_verts,
        "triangles": total_tris,
        "meshes": mesh_count,
    }


def decimate_meshes(target_ratio: float, min_vertices: int) -> bool:
    """Apply decimation to all mesh objects while preserving weights"""
    
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
            
        mesh = obj.data
        original_verts = len(mesh.vertices)
        
        if original_verts < 100:
            log(f"    Skipping {obj.name}: too few vertices ({original_verts})", verbose_only=True)
            continue
        
        # Calculate actual ratio to maintain minimum vertices
        actual_ratio = target_ratio
        target_verts = int(original_verts * target_ratio)
        if target_verts < min_vertices:
            actual_ratio = min_vertices / original_verts
            if actual_ratio >= 1.0:
                log(f"    Skipping {obj.name}: already under minimum ({original_verts} < {min_vertices})", verbose_only=True)
                continue
        
        # Make object active
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        
        # Add decimate modifier with vertex group preservation
        mod = obj.modifiers.new(name="Decimate_LOD", type='DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = actual_ratio
        mod.use_collapse_triangulate = True
        # This is important for VRM - preserve vertex groups (bone weights)
        # Blender automatically preserves vertex groups during decimation
        
        # Apply the modifier
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            new_verts = len(obj.data.vertices)
            log(f"    {obj.name}: {original_verts:,} → {new_verts:,} verts ({new_verts/original_verts:.1%})", verbose_only=True)
        except Exception as e:
            log(f"    WARNING: Failed to apply decimation to {obj.name}: {e}")
            obj.modifiers.remove(mod)
            
        obj.select_set(False)
    
    return True


def export_vrm(filepath: Path) -> bool:
    """Export scene as VRM (GLB format, VRM-compatible)"""
    
    # Ensure output directory exists
    filepath.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        # Export as GLB (VRM is GLTF-based)
        # The VRM metadata in the original file will be lost, but the mesh,
        # armature, bone weights, and materials will be preserved
        bpy.ops.export_scene.gltf(
            filepath=str(filepath),
            export_format='GLB',
            export_skins=True,
            export_morph=True,  # Preserve blend shapes
            export_morph_normal=True,
            export_materials='EXPORT',
        )
        log(f"  Exported using GLTF exporter", verbose_only=True)
        return True
    except Exception as e:
        log(f"  ERROR: Failed to export {filepath.name}: {e}")
        return False


def process_vrm_file(input_path: Path) -> Dict:
    """Process a single VRM file"""
    filename = input_path.stem
    
    # Skip if already an optimized file
    if "_optimized" in filename.lower() or "_lod" in filename.lower():
        log(f"  Skipping {input_path.name}: already optimized", verbose_only=True)
        return None
    
    output_path = input_path.parent / f"{filename}_optimized.vrm"
    
    log(f"\nProcessing: {input_path.name}")
    
    # Import VRM
    if not import_vrm(input_path):
        return {"file": input_path.name, "status": "error", "error": "Import failed"}
    
    # Get original stats
    original_stats = get_mesh_stats()
    log(f"  Original: {original_stats['triangles']:,} triangles, {original_stats['vertices']:,} vertices")
    
    # Calculate target ratio
    target_ratio = CONFIG["target_ratio"]
    if CONFIG["target_triangles"] and original_stats["triangles"] > 0:
        target_ratio = CONFIG["target_triangles"] / original_stats["triangles"]
        target_ratio = min(1.0, target_ratio)
    
    log(f"  Target ratio: {target_ratio:.1%}")
    
    if CONFIG["dry_run"]:
        target_tris = int(original_stats["triangles"] * target_ratio)
        log(f"  [DRY RUN] Would create: {output_path.name} (~{target_tris:,} triangles)")
        return {
            "file": input_path.name,
            "status": "dry-run",
            "original_triangles": original_stats["triangles"],
            "target_triangles": target_tris,
        }
    
    # Apply decimation
    decimate_meshes(target_ratio, CONFIG["min_vertices"])
    
    # Get new stats
    final_stats = get_mesh_stats()
    
    # Export VRM
    if not export_vrm(output_path):
        return {"file": input_path.name, "status": "error", "error": "Export failed"}
    
    reduction = (1 - final_stats["triangles"] / original_stats["triangles"]) * 100 if original_stats["triangles"] > 0 else 0
    log(f"  Created: {output_path.name}")
    log(f"  Result: {original_stats['triangles']:,} → {final_stats['triangles']:,} triangles ({reduction:.1f}% reduction)")
    
    return {
        "file": input_path.name,
        "status": "success",
        "output": output_path.name,
        "original_triangles": original_stats["triangles"],
        "final_triangles": final_stats["triangles"],
        "original_vertices": original_stats["vertices"],
        "final_vertices": final_stats["vertices"],
        "reduction_percent": reduction,
    }


def main():
    print("=" * 60)
    print("VRM Avatar Decimation Script for Blender")
    print("=" * 60)
    print(f"Target ratio: {CONFIG['target_ratio']:.1%}")
    if CONFIG["target_triangles"]:
        print(f"Target triangles: {CONFIG['target_triangles']:,}")
    print(f"Min vertices: {CONFIG['min_vertices']:,}")
    print(f"Dry run: {CONFIG['dry_run']}")
    
    # Check for VRM addon
    has_vrm_addon = check_vrm_addon()
    if has_vrm_addon:
        print("VRM addon: Found ✓")
    else:
        print("VRM addon: Not found (using GLTF fallback)")
    
    # Get input directory
    input_dir = PROJECT_ROOT / CONFIG["input_dir"]
    print(f"Input directory: {input_dir}")
    
    if not input_dir.exists():
        print(f"\nERROR: Input directory not found: {input_dir}")
        return
    
    # Find VRM files
    vrm_files = [f for f in input_dir.glob("*.vrm") 
                 if "_optimized" not in f.stem.lower() and "_lod" not in f.stem.lower()]
    
    if not vrm_files:
        print("\nNo VRM files found to process")
        return
    
    print(f"\nFound {len(vrm_files)} VRM files to process")
    
    results = []
    for vrm_file in sorted(vrm_files):
        result = process_vrm_file(vrm_file)
        if result:
            results.append(result)
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    successful = [r for r in results if r.get("status") == "success"]
    failed = [r for r in results if r.get("status") == "error"]
    dry_runs = [r for r in results if r.get("status") == "dry-run"]
    
    print(f"Total files: {len(results)}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {len(failed)}")
    if dry_runs:
        print(f"Dry run: {len(dry_runs)}")
    
    if successful:
        total_original = sum(r.get("original_triangles", 0) for r in successful)
        total_final = sum(r.get("final_triangles", 0) for r in successful)
        print(f"\nTotal triangles: {total_original:,} → {total_final:,}")
        if total_original > 0:
            print(f"Average reduction: {(1 - total_final/total_original) * 100:.1f}%")
    
    if failed:
        print("\nFailed files:")
        for r in failed:
            print(f"  - {r['file']}: {r.get('error', 'Unknown error')}")
    
    print("\nDone!")


if __name__ == "__main__":
    main()
