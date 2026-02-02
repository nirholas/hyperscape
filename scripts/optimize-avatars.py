#!/usr/bin/env python3
"""
VRM Avatar Optimization Script for Blender

Optimizes VRM avatar files with the following specifications:
- Textures: 2048px max color, 1024px normal, no other textures (metallic, roughness, etc.)
- LODs: 
  - LOD0: 20,000 triangles (main gameplay - required limit for characters/mobs)
  - LOD1: 8,000 triangles (distant)
  - LOD2: 2,000 triangles (very distant)

Requirements:
- Blender 3.0+ with VRM addon (vrm_addon_for_blender)
- Install VRM addon from: https://vrm-addon-for-blender.info/en/
- PIL/Pillow for texture processing

Usage:
    blender --background --python scripts/optimize-avatars.py -- [options]

Options:
    --input <dir>       Input directory (default: packages/server/world/assets/avatars)
    --output <dir>      Output directory (default: same as input)
    --lod-only          Only generate LODs, skip texture optimization
    --texture-only      Only optimize textures, skip LOD generation
    --dry-run           Show what would be done without creating files
    --verbose           Show detailed progress
    --single <file>     Process only a single file

Output:
    For each avatar.vrm, creates:
    - avatar.vrm (LOD0: 30k tris, optimized textures)
    - avatar_lod1.vrm (LOD1: 10k tris)
    - avatar_lod2.vrm (LOD2: 2k tris)
"""

import bpy
import sys
import os
import json
import struct
import base64
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass

# Parse arguments after "--"
argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

# Configuration
@dataclass
class Config:
    dry_run: bool = False
    verbose: bool = False
    lod_only: bool = False
    texture_only: bool = False
    input_dir: str = "packages/server/world/assets/avatars"
    output_dir: str = ""  # Empty = same as input
    single_file: str = ""
    
    # Texture settings
    color_max_size: int = 2048
    normal_max_size: int = 1024
    
    # LOD settings - target triangle counts
    # LOD0: 20k max for characters/mobs (as per optimization requirements)
    lod0_triangles: int = 20000
    lod1_triangles: int = 8000
    lod2_triangles: int = 2000
    
    # Minimum vertices to preserve for bone deformation quality
    min_vertices: int = 1000


CONFIG = Config()

# Parse command line arguments
i = 0
while i < len(argv):
    arg = argv[i]
    if arg == "--input" and i + 1 < len(argv):
        CONFIG.input_dir = argv[i + 1]
        i += 2
    elif arg == "--output" and i + 1 < len(argv):
        CONFIG.output_dir = argv[i + 1]
        i += 2
    elif arg == "--single" and i + 1 < len(argv):
        CONFIG.single_file = argv[i + 1]
        i += 2
    elif arg == "--dry-run":
        CONFIG.dry_run = True
        i += 1
    elif arg == "--verbose":
        CONFIG.verbose = True
        i += 1
    elif arg == "--lod-only":
        CONFIG.lod_only = True
        i += 1
    elif arg == "--texture-only":
        CONFIG.texture_only = True
        i += 1
    else:
        i += 1

# Get project root
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent


def log(msg: str, verbose_only: bool = False):
    """Print log message"""
    if verbose_only and not CONFIG.verbose:
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
    for block in bpy.data.images:
        if block.users == 0:
            bpy.data.images.remove(block)


def import_vrm(filepath: Path) -> bool:
    """Import a VRM file"""
    clear_scene()
    
    try:
        # Try VRM addon first
        if hasattr(bpy.ops.import_scene, "vrm"):
            bpy.ops.import_scene.vrm(filepath=str(filepath))
            log(f"  Imported using VRM addon", verbose_only=True)
            return True
    except Exception as e:
        log(f"  VRM addon import failed: {e}", verbose_only=True)
    
    try:
        # Fallback to GLTF importer (VRM is GLTF-based)
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
            # Count triangles (each polygon could be a quad or n-gon)
            for poly in mesh.polygons:
                # Each polygon with n vertices creates n-2 triangles when triangulated
                total_tris += len(poly.vertices) - 2
            mesh_count += 1
    
    return {
        "vertices": total_verts,
        "triangles": total_tris,
        "meshes": mesh_count,
    }


def get_texture_stats() -> Dict[str, Dict]:
    """Get texture statistics from materials"""
    textures = {}
    
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
            
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                img = node.image
                tex_type = categorize_texture(node, mat)
                
                if img.name not in textures:
                    textures[img.name] = {
                        "width": img.size[0],
                        "height": img.size[1],
                        "type": tex_type,
                        "filepath": img.filepath,
                        "packed": img.packed_file is not None,
                    }
    
    return textures


def categorize_texture(node, material) -> str:
    """Categorize texture type based on node connections"""
    # Check what the texture is connected to
    for link in material.node_tree.links:
        if link.from_node == node:
            to_socket = link.to_socket.name.lower()
            if 'color' in to_socket or 'base' in to_socket or 'diffuse' in to_socket:
                return 'color'
            elif 'normal' in to_socket:
                return 'normal'
            elif 'metallic' in to_socket or 'metal' in to_socket:
                return 'metallic'
            elif 'roughness' in to_socket or 'rough' in to_socket:
                return 'roughness'
            elif 'emission' in to_socket or 'emissive' in to_socket:
                return 'emissive'
            elif 'occlusion' in to_socket or 'ao' in to_socket:
                return 'ao'
    
    # Fallback: guess from image name
    name = node.image.name.lower()
    if any(x in name for x in ['_d', 'diffuse', 'color', 'albedo', 'base']):
        return 'color'
    elif any(x in name for x in ['_n', 'normal', 'norm']):
        return 'normal'
    elif any(x in name for x in ['_m', 'metal', 'metallic']):
        return 'metallic'
    elif any(x in name for x in ['_r', 'rough', 'roughness']):
        return 'roughness'
    
    return 'unknown'


def resize_image(image, max_size: int) -> bool:
    """Resize image to fit within max_size while preserving aspect ratio"""
    if image.size[0] <= max_size and image.size[1] <= max_size:
        return False
    
    # Calculate new size maintaining aspect ratio
    aspect = image.size[0] / image.size[1]
    if image.size[0] > image.size[1]:
        new_width = max_size
        new_height = int(max_size / aspect)
    else:
        new_height = max_size
        new_width = int(max_size * aspect)
    
    # Scale the image
    image.scale(new_width, new_height)
    return True


def optimize_textures():
    """Optimize all textures in the scene"""
    removed_textures = []
    resized_textures = []
    
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        
        nodes_to_remove = []
        
        for node in mat.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or not node.image:
                continue
            
            img = node.image
            tex_type = categorize_texture(node, mat)
            
            # Remove unnecessary texture types
            if tex_type in ['metallic', 'roughness', 'ao', 'unknown']:
                nodes_to_remove.append(node)
                removed_textures.append(f"{img.name} ({tex_type})")
                continue
            
            # Resize based on type
            max_size = CONFIG.color_max_size if tex_type == 'color' else CONFIG.normal_max_size
            original_size = (img.size[0], img.size[1])
            
            if resize_image(img, max_size):
                resized_textures.append(f"{img.name}: {original_size[0]}x{original_size[1]} → {img.size[0]}x{img.size[1]}")
        
        # Remove unnecessary texture nodes
        for node in nodes_to_remove:
            # Disconnect links first
            for link in list(mat.node_tree.links):
                if link.from_node == node or link.to_node == node:
                    mat.node_tree.links.remove(link)
            mat.node_tree.nodes.remove(node)
    
    # Set metalness/roughness to default values on all materials
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                # Set default values for removed textures
                if hasattr(node.inputs, 'Metallic'):
                    node.inputs['Metallic'].default_value = 0.0
                if hasattr(node.inputs, 'Roughness'):
                    node.inputs['Roughness'].default_value = 1.0
    
    return removed_textures, resized_textures


def decimate_to_target(target_triangles: int) -> bool:
    """Decimate all meshes to reach target triangle count"""
    stats = get_mesh_stats()
    current_tris = stats["triangles"]
    
    if current_tris <= target_triangles:
        log(f"  Already at or below target ({current_tris:,} ≤ {target_triangles:,})", verbose_only=True)
        return True
    
    # Calculate decimation ratio
    target_ratio = target_triangles / current_tris
    
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        
        mesh = obj.data
        original_verts = len(mesh.vertices)
        
        if original_verts < 100:
            log(f"    Skipping {obj.name}: too few vertices ({original_verts})", verbose_only=True)
            continue
        
        # Make object active
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        
        # Add decimate modifier
        mod = obj.modifiers.new(name="Decimate_LOD", type='DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = target_ratio
        mod.use_collapse_triangulate = True
        # Blender automatically preserves vertex groups (bone weights) during decimation
        
        # Apply the modifier
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            new_verts = len(obj.data.vertices)
            log(f"    {obj.name}: {original_verts:,} → {new_verts:,} verts", verbose_only=True)
        except Exception as e:
            log(f"    WARNING: Failed to apply decimation to {obj.name}: {e}")
            obj.modifiers.remove(mod)
        
        obj.select_set(False)
    
    return True


def triangulate_meshes():
    """Convert all meshes to triangles for accurate triangle counting"""
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        
        # Add triangulate modifier
        mod = obj.modifiers.new(name="Triangulate", type='TRIANGULATE')
        
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except:
            obj.modifiers.remove(mod)
        
        obj.select_set(False)


def export_vrm(filepath: Path) -> bool:
    """Export scene as VRM"""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        # Try VRM addon export first
        if hasattr(bpy.ops.export_scene, "vrm"):
            bpy.ops.export_scene.vrm(filepath=str(filepath))
            log(f"  Exported using VRM addon", verbose_only=True)
            return True
    except Exception as e:
        log(f"  VRM addon export failed: {e}", verbose_only=True)
    
    try:
        # Fallback to GLB export (loses VRM metadata but preserves mesh/bones/materials)
        bpy.ops.export_scene.gltf(
            filepath=str(filepath),
            export_format='GLB',
            export_skins=True,
            export_morph=True,
            export_morph_normal=True,
            export_materials='EXPORT',
        )
        log(f"  Exported using GLTF exporter (VRM metadata may be lost)", verbose_only=True)
        return True
    except Exception as e:
        log(f"  ERROR: Failed to export {filepath.name}: {e}")
        return False


def process_avatar(input_path: Path, output_dir: Path) -> Dict:
    """Process a single avatar file"""
    filename = input_path.stem
    
    # Skip if already an optimized/LOD file
    if any(x in filename.lower() for x in ['_optimized', '_lod1', '_lod2']):
        log(f"  Skipping {input_path.name}: already processed", verbose_only=True)
        return None
    
    log(f"\n{'='*60}")
    log(f"Processing: {input_path.name}")
    log(f"{'='*60}")
    
    results = {
        "file": input_path.name,
        "status": "pending",
        "lod0": None,
        "lod1": None,
        "lod2": None,
        "textures_removed": [],
        "textures_resized": [],
    }
    
    # ===== LOD0 (30k triangles with optimized textures) =====
    if not CONFIG.lod_only or not CONFIG.texture_only:
        log(f"\n[LOD0] Creating optimized base model (target: {CONFIG.lod0_triangles:,} triangles)")
        
        if not import_vrm(input_path):
            results["status"] = "error"
            results["error"] = "Import failed"
            return results
        
        original_stats = get_mesh_stats()
        log(f"  Original: {original_stats['triangles']:,} triangles, {original_stats['vertices']:,} vertices")
        
        # Optimize textures
        if not CONFIG.lod_only:
            log(f"  Optimizing textures...")
            removed, resized = optimize_textures()
            results["textures_removed"] = removed
            results["textures_resized"] = resized
            if removed:
                log(f"    Removed {len(removed)} textures: {', '.join(removed[:3])}{'...' if len(removed) > 3 else ''}")
            if resized:
                log(f"    Resized {len(resized)} textures")
        
        # Triangulate before decimation for accurate counting
        triangulate_meshes()
        
        # Decimate to LOD0 target
        if not CONFIG.texture_only:
            decimate_to_target(CONFIG.lod0_triangles)
        
        final_stats = get_mesh_stats()
        log(f"  Final: {final_stats['triangles']:,} triangles, {final_stats['vertices']:,} vertices")
        
        if not CONFIG.dry_run:
            lod0_path = output_dir / f"{filename}.vrm"
            if export_vrm(lod0_path):
                results["lod0"] = {
                    "path": str(lod0_path),
                    "triangles": final_stats["triangles"],
                    "vertices": final_stats["vertices"],
                }
    
    # ===== LOD1 (10k triangles) =====
    if not CONFIG.texture_only:
        log(f"\n[LOD1] Creating medium LOD (target: {CONFIG.lod1_triangles:,} triangles)")
        
        if not import_vrm(input_path):
            results["status"] = "error"
            return results
        
        # Optimize textures
        if not CONFIG.lod_only:
            optimize_textures()
        
        triangulate_meshes()
        decimate_to_target(CONFIG.lod1_triangles)
        
        lod1_stats = get_mesh_stats()
        log(f"  Result: {lod1_stats['triangles']:,} triangles")
        
        if not CONFIG.dry_run:
            lod1_path = output_dir / f"{filename}_lod1.vrm"
            if export_vrm(lod1_path):
                results["lod1"] = {
                    "path": str(lod1_path),
                    "triangles": lod1_stats["triangles"],
                    "vertices": lod1_stats["vertices"],
                }
    
    # ===== LOD2 (2k triangles) =====
    if not CONFIG.texture_only:
        log(f"\n[LOD2] Creating low LOD (target: {CONFIG.lod2_triangles:,} triangles)")
        
        if not import_vrm(input_path):
            results["status"] = "error"
            return results
        
        # Optimize textures
        if not CONFIG.lod_only:
            optimize_textures()
        
        triangulate_meshes()
        decimate_to_target(CONFIG.lod2_triangles)
        
        lod2_stats = get_mesh_stats()
        log(f"  Result: {lod2_stats['triangles']:,} triangles")
        
        if not CONFIG.dry_run:
            lod2_path = output_dir / f"{filename}_lod2.vrm"
            if export_vrm(lod2_path):
                results["lod2"] = {
                    "path": str(lod2_path),
                    "triangles": lod2_stats["triangles"],
                    "vertices": lod2_stats["vertices"],
                }
    
    results["status"] = "success"
    return results


def main():
    print("=" * 60)
    print("VRM Avatar Optimization Script")
    print("=" * 60)
    print(f"Target LOD0: {CONFIG.lod0_triangles:,} triangles")
    print(f"Target LOD1: {CONFIG.lod1_triangles:,} triangles")
    print(f"Target LOD2: {CONFIG.lod2_triangles:,} triangles")
    print(f"Color texture max: {CONFIG.color_max_size}px")
    print(f"Normal texture max: {CONFIG.normal_max_size}px")
    print(f"Dry run: {CONFIG.dry_run}")
    print(f"LOD only: {CONFIG.lod_only}")
    print(f"Texture only: {CONFIG.texture_only}")
    
    # Check for VRM addon
    has_vrm_addon = hasattr(bpy.ops.import_scene, "vrm")
    if has_vrm_addon:
        print("VRM addon: Found ✓")
    else:
        print("VRM addon: Not found (using GLTF fallback - VRM metadata will be lost)")
        print("  Install from: https://vrm-addon-for-blender.info/en/")
    
    # Get input/output directories
    input_dir = PROJECT_ROOT / CONFIG.input_dir
    output_dir = PROJECT_ROOT / (CONFIG.output_dir if CONFIG.output_dir else CONFIG.input_dir)
    
    print(f"Input directory: {input_dir}")
    print(f"Output directory: {output_dir}")
    
    if not input_dir.exists():
        print(f"\nERROR: Input directory not found: {input_dir}")
        return
    
    # Find VRM files
    if CONFIG.single_file:
        single_path = Path(CONFIG.single_file)
        if not single_path.is_absolute():
            single_path = input_dir / single_path
        if not single_path.exists():
            print(f"\nERROR: File not found: {single_path}")
            return
        vrm_files = [single_path]
    else:
        vrm_files = [
            f for f in input_dir.glob("*.vrm")
            if not any(x in f.stem.lower() for x in ['_optimized', '_lod1', '_lod2'])
        ]
    
    if not vrm_files:
        print("\nNo VRM files found to process")
        return
    
    print(f"\nFound {len(vrm_files)} VRM files to process")
    
    results = []
    for vrm_file in sorted(vrm_files):
        result = process_avatar(vrm_file, output_dir)
        if result:
            results.append(result)
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    successful = [r for r in results if r.get("status") == "success"]
    failed = [r for r in results if r.get("status") == "error"]
    
    print(f"Total files: {len(results)}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {len(failed)}")
    
    if successful:
        print("\nGenerated files:")
        for r in successful:
            print(f"  {r['file']}:")
            if r.get('lod0'):
                print(f"    LOD0: {r['lod0']['triangles']:,} tris")
            if r.get('lod1'):
                print(f"    LOD1: {r['lod1']['triangles']:,} tris")
            if r.get('lod2'):
                print(f"    LOD2: {r['lod2']['triangles']:,} tris")
    
    if failed:
        print("\nFailed files:")
        for r in failed:
            print(f"  - {r['file']}: {r.get('error', 'Unknown error')}")
    
    print("\nDone!")


if __name__ == "__main__":
    main()
