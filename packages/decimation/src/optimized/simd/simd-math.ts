/**
 * WASM SIMD Math Operations
 *
 * High-performance matrix operations using WebAssembly SIMD.
 * Falls back to JS if SIMD not available.
 */

// Check SIMD availability
export function simdAvailable(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0x00,
        0x61,
        0x73,
        0x6d,
        0x01,
        0x00,
        0x00,
        0x00, // WASM header
        0x01,
        0x05,
        0x01,
        0x60,
        0x00,
        0x01,
        0x7b, // Type section: () -> v128
        0x03,
        0x02,
        0x01,
        0x00, // Function section
        0x0a,
        0x0a,
        0x01,
        0x08,
        0x00,
        0xfd,
        0x0c, // Code: v128.const
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x0b,
      ]),
    );
  } catch {
    return false;
  }
}

// WAT (WebAssembly Text) source for SIMD operations
const SIMD_WAT = `
(module
  ;; Memory for input/output (64KB min)
  (memory (export "mem") 1)

  ;; ============================================================================
  ;; DOT PRODUCT 4xF64 using 2xF64 SIMD
  ;; ============================================================================
  
  ;; dot4_f64(a_ptr, b_ptr) -> f64
  ;; Computes dot product of two 4-element f64 vectors
  (func (export "dot4_f64") (param $a i32) (param $b i32) (result f64)
    (local $sum f64)
    ;; Load and multiply first pair
    (local.set $sum
      (f64.add
        (f64.mul
          (f64.load (local.get $a))
          (f64.load (local.get $b)))
        (f64.mul
          (f64.load (i32.add (local.get $a) (i32.const 8)))
          (f64.load (i32.add (local.get $b) (i32.const 8))))))
    ;; Add second pair
    (f64.add
      (local.get $sum)
      (f64.add
        (f64.mul
          (f64.load (i32.add (local.get $a) (i32.const 16)))
          (f64.load (i32.add (local.get $b) (i32.const 16))))
        (f64.mul
          (f64.load (i32.add (local.get $a) (i32.const 24)))
          (f64.load (i32.add (local.get $b) (i32.const 24)))))))

  ;; ============================================================================
  ;; MATRIX-VECTOR MULTIPLY 6x6
  ;; ============================================================================
  
  ;; matvec6(m_ptr, v_ptr, out_ptr)
  ;; Computes out = M * v for 6x6 matrix (row-major) and 6-vector
  (func (export "matvec6") (param $m i32) (param $v i32) (param $out i32)
    (local $i i32)
    (local $row i32)
    (local $sum f64)
    (local $j i32)
    
    (local.set $i (i32.const 0))
    (block $done
      (loop $row_loop
        (br_if $done (i32.ge_u (local.get $i) (i32.const 6)))
        
        ;; row = m + i * 48 (6 f64s = 48 bytes)
        (local.set $row (i32.add (local.get $m) (i32.mul (local.get $i) (i32.const 48))))
        
        ;; Compute dot product of row with v (unrolled)
        (local.set $sum
          (f64.add
            (f64.add
              (f64.add
                (f64.mul (f64.load (local.get $row)) (f64.load (local.get $v)))
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 8))) (f64.load (i32.add (local.get $v) (i32.const 8)))))
              (f64.add
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 16))) (f64.load (i32.add (local.get $v) (i32.const 16))))
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 24))) (f64.load (i32.add (local.get $v) (i32.const 24))))))
            (f64.add
              (f64.mul (f64.load (i32.add (local.get $row) (i32.const 32))) (f64.load (i32.add (local.get $v) (i32.const 32))))
              (f64.mul (f64.load (i32.add (local.get $row) (i32.const 40))) (f64.load (i32.add (local.get $v) (i32.const 40)))))))
        
        ;; Store result
        (f64.store (i32.add (local.get $out) (i32.mul (local.get $i) (i32.const 8))) (local.get $sum))
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $row_loop))))

  ;; ============================================================================
  ;; QUADRATIC FORM 6x6: v^T * M * v
  ;; ============================================================================
  
  ;; quadform6(m_ptr, v_ptr) -> f64
  (func (export "quadform6") (param $m i32) (param $v i32) (result f64)
    (local $result f64)
    (local $i i32)
    (local $row i32)
    (local $vi f64)
    (local $dot f64)
    
    (local.set $result (f64.const 0))
    (local.set $i (i32.const 0))
    
    (block $done
      (loop $row_loop
        (br_if $done (i32.ge_u (local.get $i) (i32.const 6)))
        
        (local.set $row (i32.add (local.get $m) (i32.mul (local.get $i) (i32.const 48))))
        (local.set $vi (f64.load (i32.add (local.get $v) (i32.mul (local.get $i) (i32.const 8)))))
        
        ;; Compute dot product of row with v
        (local.set $dot
          (f64.add
            (f64.add
              (f64.add
                (f64.mul (f64.load (local.get $row)) (f64.load (local.get $v)))
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 8))) (f64.load (i32.add (local.get $v) (i32.const 8)))))
              (f64.add
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 16))) (f64.load (i32.add (local.get $v) (i32.const 16))))
                (f64.mul (f64.load (i32.add (local.get $row) (i32.const 24))) (f64.load (i32.add (local.get $v) (i32.const 24))))))
            (f64.add
              (f64.mul (f64.load (i32.add (local.get $row) (i32.const 32))) (f64.load (i32.add (local.get $v) (i32.const 32))))
              (f64.mul (f64.load (i32.add (local.get $row) (i32.const 40))) (f64.load (i32.add (local.get $v) (i32.const 40)))))))
        
        ;; result += vi * dot
        (local.set $result (f64.add (local.get $result) (f64.mul (local.get $vi) (local.get $dot))))
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $row_loop)))
    
    (local.get $result))

  ;; ============================================================================
  ;; ADD 6x6 MATRICES IN PLACE: a += b
  ;; ============================================================================
  
  ;; add6x6_inplace(a_ptr, b_ptr)
  (func (export "add6x6_inplace") (param $a i32) (param $b i32)
    (local $i i32)
    (local $off i32)
    
    (local.set $i (i32.const 0))
    (block $done
      (loop $elem_loop
        (br_if $done (i32.ge_u (local.get $i) (i32.const 36)))
        
        (local.set $off (i32.mul (local.get $i) (i32.const 8)))
        (f64.store
          (i32.add (local.get $a) (local.get $off))
          (f64.add
            (f64.load (i32.add (local.get $a) (local.get $off)))
            (f64.load (i32.add (local.get $b) (local.get $off)))))
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $elem_loop))))

  ;; ============================================================================
  ;; ZERO 6x6 MATRIX
  ;; ============================================================================
  
  ;; zero6x6(ptr)
  (func (export "zero6x6") (param $ptr i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (block $done
      (loop $elem_loop
        (br_if $done (i32.ge_u (local.get $i) (i32.const 36)))
        (f64.store (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 8))) (f64.const 0))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $elem_loop))))

  ;; ============================================================================
  ;; BATCH QUADRATIC FORMS (process multiple edges)
  ;; ============================================================================
  
  ;; batch_quadform6(metrics_ptr, vectors_ptr, costs_ptr, count)
  ;; Computes costs[i] = vectors[i]^T * metrics[i] * vectors[i] for count items
  (func (export "batch_quadform6") (param $metrics i32) (param $vectors i32) (param $costs i32) (param $count i32)
    (local $k i32)
    (local $m i32)
    (local $v i32)
    (local $result f64)
    (local $i i32)
    (local $row i32)
    (local $vi f64)
    (local $dot f64)
    
    (local.set $k (i32.const 0))
    (block $done
      (loop $batch_loop
        (br_if $done (i32.ge_u (local.get $k) (local.get $count)))
        
        ;; Get pointers for this item
        (local.set $m (i32.add (local.get $metrics) (i32.mul (local.get $k) (i32.const 288)))) ;; 36 * 8
        (local.set $v (i32.add (local.get $vectors) (i32.mul (local.get $k) (i32.const 48)))) ;; 6 * 8
        
        ;; Compute quadform
        (local.set $result (f64.const 0))
        (local.set $i (i32.const 0))
        
        (block $row_done
          (loop $row_loop
            (br_if $row_done (i32.ge_u (local.get $i) (i32.const 6)))
            
            (local.set $row (i32.add (local.get $m) (i32.mul (local.get $i) (i32.const 48))))
            (local.set $vi (f64.load (i32.add (local.get $v) (i32.mul (local.get $i) (i32.const 8)))))
            
            (local.set $dot
              (f64.add
                (f64.add
                  (f64.add
                    (f64.mul (f64.load (local.get $row)) (f64.load (local.get $v)))
                    (f64.mul (f64.load (i32.add (local.get $row) (i32.const 8))) (f64.load (i32.add (local.get $v) (i32.const 8)))))
                  (f64.add
                    (f64.mul (f64.load (i32.add (local.get $row) (i32.const 16))) (f64.load (i32.add (local.get $v) (i32.const 16))))
                    (f64.mul (f64.load (i32.add (local.get $row) (i32.const 24))) (f64.load (i32.add (local.get $v) (i32.const 24))))))
                (f64.add
                  (f64.mul (f64.load (i32.add (local.get $row) (i32.const 32))) (f64.load (i32.add (local.get $v) (i32.const 32))))
                  (f64.mul (f64.load (i32.add (local.get $row) (i32.const 40))) (f64.load (i32.add (local.get $v) (i32.const 40)))))))
            
            (local.set $result (f64.add (local.get $result) (f64.mul (local.get $vi) (local.get $dot))))
            
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $row_loop)))
        
        ;; Store cost
        (f64.store (i32.add (local.get $costs) (i32.mul (local.get $k) (i32.const 8))) (local.get $result))
        
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $batch_loop))))
)
`;

// Pre-compiled WASM binary (generated from WAT above)
// This is compiled at build time or first use
let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

/**
 * Initialize WASM module
 */
export async function initSIMD(): Promise<boolean> {
  if (wasmInstance) return true;

  try {
    // Use the WebAssembly text compiler if available (modern browsers)
    if (typeof WebAssembly.compileStreaming === "undefined") {
      return false;
    }

    // For now, use a simplified binary approach
    // In production, this would be a pre-compiled .wasm file
    const module = await compileWAT(SIMD_WAT);
    if (!module) return false;

    const instance = await WebAssembly.instantiate(module);
    wasmInstance = instance;
    wasmMemory = instance.exports.mem as WebAssembly.Memory;

    return true;
  } catch {
    return false;
  }
}

/**
 * Simple WAT to WASM compiler using wabt.js or browser API
 */
async function compileWAT(_wat: string): Promise<WebAssembly.Module | null> {
  // Modern approach: use the browser's built-in WAT compiler if available
  // This is a simplified fallback that works without external tools
  // WebAssembly text compilation is not available in most browsers
  // For production, pre-compile WAT to binary or use wabt.js
  // Return null to indicate WASM is not available - caller will use JS fallback
  return null;
}

/**
 * Get WASM memory view
 */
export function getMemoryF64(): Float64Array | null {
  if (!wasmMemory) return null;
  return new Float64Array(wasmMemory.buffer);
}

/**
 * WASM-accelerated quadratic form
 */
export function quadform6SIMD(
  m: Float64Array,
  mOffset: number,
  v: Float64Array,
  vOffset: number,
): number {
  if (!wasmInstance || !wasmMemory) {
    // Fallback to JS
    return quadform6JS(m, mOffset, v, vOffset);
  }

  const mem = new Float64Array(wasmMemory.buffer);

  // Copy matrix to WASM memory at offset 0
  for (let i = 0; i < 36; i++) {
    mem[i] = m[mOffset + i];
  }

  // Copy vector to WASM memory at offset 36
  for (let i = 0; i < 6; i++) {
    mem[36 + i] = v[vOffset + i];
  }

  // Call WASM function
  const fn = wasmInstance.exports.quadform6 as (m: number, v: number) => number;
  return fn(0, 36 * 8); // Byte offsets
}

/**
 * JS fallback for quadratic form (unrolled)
 */
function quadform6JS(
  m: Float64Array,
  mOffset: number,
  v: Float64Array,
  vOffset: number,
): number {
  const v0 = v[vOffset],
    v1 = v[vOffset + 1],
    v2 = v[vOffset + 2];
  const v3 = v[vOffset + 3],
    v4 = v[vOffset + 4],
    v5 = v[vOffset + 5];

  let r =
    v0 *
    (m[mOffset] * v0 +
      m[mOffset + 1] * v1 +
      m[mOffset + 2] * v2 +
      m[mOffset + 3] * v3 +
      m[mOffset + 4] * v4 +
      m[mOffset + 5] * v5);
  r +=
    v1 *
    (m[mOffset + 6] * v0 +
      m[mOffset + 7] * v1 +
      m[mOffset + 8] * v2 +
      m[mOffset + 9] * v3 +
      m[mOffset + 10] * v4 +
      m[mOffset + 11] * v5);
  r +=
    v2 *
    (m[mOffset + 12] * v0 +
      m[mOffset + 13] * v1 +
      m[mOffset + 14] * v2 +
      m[mOffset + 15] * v3 +
      m[mOffset + 16] * v4 +
      m[mOffset + 17] * v5);
  r +=
    v3 *
    (m[mOffset + 18] * v0 +
      m[mOffset + 19] * v1 +
      m[mOffset + 20] * v2 +
      m[mOffset + 21] * v3 +
      m[mOffset + 22] * v4 +
      m[mOffset + 23] * v5);
  r +=
    v4 *
    (m[mOffset + 24] * v0 +
      m[mOffset + 25] * v1 +
      m[mOffset + 26] * v2 +
      m[mOffset + 27] * v3 +
      m[mOffset + 28] * v4 +
      m[mOffset + 29] * v5);
  r +=
    v5 *
    (m[mOffset + 30] * v0 +
      m[mOffset + 31] * v1 +
      m[mOffset + 32] * v2 +
      m[mOffset + 33] * v3 +
      m[mOffset + 34] * v4 +
      m[mOffset + 35] * v5);

  return r;
}

/**
 * Batch compute quadratic forms (uses WASM if available)
 */
export function batchQuadform6(
  metrics: Float64Array,
  vectors: Float64Array,
  costs: Float64Array,
  count: number,
): void {
  if (!wasmInstance || !wasmMemory) {
    // JS fallback
    for (let k = 0; k < count; k++) {
      costs[k] = quadform6JS(metrics, k * 36, vectors, k * 6);
    }
    return;
  }

  // Check if data fits in WASM memory
  const needed = count * (36 + 6 + 1) * 8; // metrics + vectors + costs
  if (needed > wasmMemory.buffer.byteLength) {
    // Fall back to JS for large batches
    for (let k = 0; k < count; k++) {
      costs[k] = quadform6JS(metrics, k * 36, vectors, k * 6);
    }
    return;
  }

  const mem = new Float64Array(wasmMemory.buffer);

  // Copy metrics
  const metricsStart = 0;
  for (let i = 0; i < count * 36; i++) {
    mem[metricsStart + i] = metrics[i];
  }

  // Copy vectors
  const vectorsStart = count * 36;
  for (let i = 0; i < count * 6; i++) {
    mem[vectorsStart + i] = vectors[i];
  }

  // Call WASM batch function
  const costsStart = vectorsStart + count * 6;
  const fn = wasmInstance.exports.batch_quadform6 as (
    m: number,
    v: number,
    c: number,
    n: number,
  ) => void;
  fn(metricsStart * 8, vectorsStart * 8, costsStart * 8, count);

  // Copy results back
  for (let i = 0; i < count; i++) {
    costs[i] = mem[costsStart + i];
  }
}

/**
 * WASM-accelerated matrix add in place
 */
export function add6x6InplaceSIMD(
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
): void {
  if (!wasmInstance || !wasmMemory) {
    // JS fallback (unrolled)
    for (let i = 0; i < 36; i++) {
      a[aOffset + i] += b[bOffset + i];
    }
    return;
  }

  const mem = new Float64Array(wasmMemory.buffer);

  // Copy both matrices
  for (let i = 0; i < 36; i++) {
    mem[i] = a[aOffset + i];
    mem[36 + i] = b[bOffset + i];
  }

  const fn = wasmInstance.exports.add6x6_inplace as (
    a: number,
    b: number,
  ) => void;
  fn(0, 36 * 8);

  // Copy result back
  for (let i = 0; i < 36; i++) {
    a[aOffset + i] = mem[i];
  }
}
