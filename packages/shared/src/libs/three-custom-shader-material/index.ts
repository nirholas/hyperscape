/**
 * three-custom-shader-material compatibility layer
 *
 * This module provides backward compatibility for code that imported
 * from three-custom-shader-material. Now that we use TSL Node Materials,
 * we export MeshStandardNodeMaterial as a drop-in replacement.
 *
 * For new code, import directly from 'three/tsl' or '../../extras/three/three'
 *
 * @deprecated Use MeshStandardNodeMaterial from three/tsl instead
 */

import { MeshStandardNodeMaterial } from "../../extras/three/three";

// Export MeshStandardNodeMaterial as the default (CustomShaderMaterial replacement)
export default MeshStandardNodeMaterial;

// Also export as named export for compatibility
export { MeshStandardNodeMaterial as CustomShaderMaterial };
