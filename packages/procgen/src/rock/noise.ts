/**
 * Simplex Noise Implementation
 *
 * 3D Simplex noise with FBM and ridged noise variants for rock generation.
 * Based on Ken Perlin's improved noise and Stefan Gustavson's implementation.
 */

/**
 * Simplex noise generator with seeded initialization
 */
export class SimplexNoise {
  private readonly p: Uint8Array;
  private readonly perm: Uint8Array;
  private readonly permMod12: Uint8Array;
  private readonly grad3: Float32Array;
  private readonly F3: number;
  private readonly G3: number;

  constructor(seed: number = 0) {
    this.p = new Uint8Array(256);
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);

    // Initialize permutation table
    for (let i = 0; i < 256; i++) {
      this.p[i] = i;
    }

    // Shuffle using seed (LCG)
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
    }

    // Extend permutation table
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }

    // 3D gradient vectors
    this.grad3 = new Float32Array([
      1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1,
      0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
    ]);

    // Skewing/unskewing factors for 3D
    this.F3 = 1.0 / 3.0;
    this.G3 = 1.0 / 6.0;
  }

  /**
   * 3D Simplex noise at coordinates (x, y, z)
   * @returns Value in range [-1, 1]
   */
  noise3D(x: number, y: number, z: number): number {
    const { perm, permMod12, grad3, F3, G3 } = this;

    // Skew the input space to determine simplex cell
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);

    // Unskew back to find cell origin
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;

    // Relative coordinates within cell
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    // Determine which simplex we're in
    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }
    }

    // Offsets for remaining corners
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;
    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    // Hash coordinates of corners
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    // Calculate contributions from corners
    let n0 = 0,
      n1 = 0,
      n2 = 0,
      n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 =
        t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 =
        t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 =
        t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 =
        t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
    }

    // Sum contributions and scale to [-1, 1]
    return 32.0 * (n0 + n1 + n2 + n3);
  }

  /**
   * 2D Simplex noise (uses 3D with z=0)
   * @returns Value in range [-1, 1]
   */
  noise2D(x: number, y: number): number {
    return this.noise3D(x, y, 0);
  }

  /**
   * 2D Fractal Brownian Motion for textures
   * @returns Normalized value in range [-1, 1]
   */
  fbm2D(
    x: number,
    y: number,
    octaves: number,
    lacunarity: number,
    persistence: number,
  ): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  /**
   * Fractal Brownian Motion (FBM) noise
   * Combines multiple octaves of noise for natural-looking variation
   * @returns Normalized value in range [-1, 1]
   */
  fbm(
    x: number,
    y: number,
    z: number,
    octaves: number,
    lacunarity: number,
    persistence: number,
  ): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value +=
        amplitude * this.noise3D(x * frequency, y * frequency, z * frequency);
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  /**
   * Ridged multifractal noise
   * Creates sharp ridges/creases, good for cracks and crevices
   * @returns Normalized value in range [0, 1]
   */
  ridged(
    x: number,
    y: number,
    z: number,
    octaves: number,
    lacunarity: number,
    persistence: number,
  ): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      const n =
        1.0 -
        Math.abs(this.noise3D(x * frequency, y * frequency, z * frequency));
      value += amplitude * n * n;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}

// hashSeed is re-exported from math/Random.ts
export { hashSeed } from "../math/Random.js";
