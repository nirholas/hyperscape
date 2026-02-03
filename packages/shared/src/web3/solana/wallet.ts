/**
 * @fileoverview Solana wallet generation and management service for Hyperscape.
 * Provides secure keypair generation, vanity address creation, and RPC operations.
 *
 * Uses Ed25519 cryptography for keypair operations. This implementation uses
 * a pure JavaScript Ed25519 implementation for maximum compatibility.
 *
 * @security This module handles sensitive cryptographic material:
 * - Never log secret keys
 * - Use zeroize() to clear sensitive data from memory
 * - Set secure file permissions when saving wallets
 *
 * @module web3/solana/wallet
 */

import type {
  SolanaWallet,
  SolanaWalletExport,
  SolanaConfig,
  SolanaBalance,
  TransferRequest,
  TransferResult,
  VanityOptions,
  VanityResult,
  VanityProgress,
  AirdropResult,
  BlockhashInfo,
  AddressValidation,
  SolanaCommitment,
  SolanaCluster,
} from "./types";

import {
  BASE58_ALPHABET,
  BASE58_CHARS,
  PUBLIC_KEY_LENGTH,
  SECRET_KEY_LENGTH,
  ADDRESS_MIN_LENGTH,
  ADDRESS_MAX_LENGTH,
  MAX_VANITY_PATTERN_LENGTH,
  VANITY_PROGRESS_INTERVAL,
  DEFAULT_RPC_TIMEOUT_MS,
  CONFUSED_CHARACTERS,
  lamportsToSol,
  estimateVanityAttempts,
  getClusterUrl,
  isMainnetCluster,
} from "./constants";

// ============================================================
// Ed25519 Constants
// ============================================================

/** Ed25519 field prime: 2^255 - 19 */
const P = 2n ** 255n - 19n;

/** Ed25519 curve order */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

/** d constant for Ed25519: -121665/121666 mod p */
const D = (() => {
  const d_num = -121665n;
  const d_den = 121666n;
  // Extended Euclidean algorithm for modular inverse
  let [old_r, r] = [P, d_den];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  const inv = ((old_s % P) + P) % P;
  return (((d_num * inv) % P) + P) % P;
})();

/** Ed25519 base point */
interface Point {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

const G: Point = {
  x: 15112221349535807912866137220509078935008241517919447467267454458027974508297n,
  y: 46316835694926478169428394003475163141307993866256225615783033603165251855960n,
  z: 1n,
  t: 46827403850823179245072216630277197565144205554125654976674165829533817101731n,
};

// ============================================================
// Modular Arithmetic
// ============================================================

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

function modInv(a: bigint, m: bigint): bigint {
  return modPow(a, m - 2n, m);
}

function modSqrt(x: bigint): bigint {
  const p38 = (P + 3n) / 8n;
  let y = modPow(x, p38, P);
  if (mod(y * y, P) !== mod(x, P)) {
    const sqrtM1 = modPow(2n, (P - 1n) / 4n, P);
    y = mod(y * sqrtM1, P);
  }
  if (y & 1n) y = P - y;
  return y;
}

// ============================================================
// Ed25519 Point Operations
// ============================================================

function pointDouble(p: Point): Point {
  const { x, y, z } = p;
  const a = mod(x * x, P);
  const b = mod(y * y, P);
  const c = mod(2n * z * z, P);
  const h = mod(a + b, P);
  const e = mod(mod((x + y) * (x + y), P) - h, P);
  const g = mod(b - a, P);
  const f = mod(g - c, P);
  return {
    x: mod(e * f, P),
    y: mod(g * h, P),
    z: mod(f * g, P),
    t: mod(e * h, P),
  };
}

function pointAdd(p1: Point, p2: Point): Point {
  const { x: x1, y: y1, z: z1, t: t1 } = p1;
  const { x: x2, y: y2, z: z2, t: t2 } = p2;
  const a = mod((y1 - x1) * (y2 - x2), P);
  const b = mod((y1 + x1) * (y2 + x2), P);
  const c = mod(2n * t1 * t2 * D, P);
  const d = mod(2n * z1 * z2, P);
  const e = mod(b - a, P);
  const f = mod(d - c, P);
  const g = mod(d + c, P);
  const h = mod(b + a, P);
  return {
    x: mod(e * f, P),
    y: mod(g * h, P),
    z: mod(f * g, P),
    t: mod(e * h, P),
  };
}

function scalarMult(n: bigint, point: Point): Point {
  let result: Point = { x: 0n, y: 1n, z: 1n, t: 0n };
  let addend = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    n >>= 1n;
  }
  return result;
}

function encodePoint(p: Point): Uint8Array {
  const zInv = modInv(p.z, P);
  const x = mod(p.x * zInv, P);
  const y = mod(p.y * zInv, P);
  const bytes = new Uint8Array(32);
  let yTemp = y;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(yTemp & 0xffn);
    yTemp >>= 8n;
  }
  if (x & 1n) bytes[31] |= 0x80;
  return bytes;
}

function decodePoint(bytes: Uint8Array): Point {
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    y = (y << 8n) | BigInt(bytes[i]! & (i === 31 ? 0x7f : 0xff));
  }
  const xSign = (bytes[31]! >> 7) & 1;
  const y2 = mod(y * y, P);
  const num = mod(y2 - 1n, P);
  const den = mod(D * y2 + 1n, P);
  const x2 = mod(num * modInv(den, P), P);
  let x = modSqrt(x2);
  if (Number(x & 1n) !== xSign) x = mod(P - x, P);
  return { x, y, z: 1n, t: mod(x * y, P) };
}

// ============================================================
// SHA-512 Implementation
// ============================================================

const SHA512_K: bigint[] = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

const MASK64 = (1n << 64n) - 1n;

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function sha512(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667f3bcc908n;
  let h1 = 0xbb67ae8584caa73bn;
  let h2 = 0x3c6ef372fe94f82bn;
  let h3 = 0xa54ff53a5f1d36f1n;
  let h4 = 0x510e527fade682d1n;
  let h5 = 0x9b05688c2b3e6c1fn;
  let h6 = 0x1f83d9abfb41bd6bn;
  let h7 = 0x5be0cd19137e2179n;

  const bitLen = BigInt(message.length * 8);
  const padLen =
    message.length % 128 < 112
      ? 112 - (message.length % 128)
      : 240 - (message.length % 128);

  const padded = new Uint8Array(message.length + padLen + 16);
  padded.set(message);
  padded[message.length] = 0x80;

  const lenView = new DataView(padded.buffer, padded.length - 8, 8);
  lenView.setBigUint64(0, bitLen, false);

  const view = new DataView(padded.buffer);

  for (let offset = 0; offset < padded.length; offset += 128) {
    const W: bigint[] = new Array(80);

    for (let i = 0; i < 16; i++) {
      W[i] = view.getBigUint64(offset + i * 8, false);
    }

    for (let i = 16; i < 80; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr64(w15, 1n) ^ rotr64(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr64(w2, 19n) ^ rotr64(w2, 61n) ^ (w2 >> 6n);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) & MASK64;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const temp1 = (h + S1 + ch + SHA512_K[i]! + W[i]!) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }

    h0 = (h0 + a) & MASK64;
    h1 = (h1 + b) & MASK64;
    h2 = (h2 + c) & MASK64;
    h3 = (h3 + d) & MASK64;
    h4 = (h4 + e) & MASK64;
    h5 = (h5 + f) & MASK64;
    h6 = (h6 + g) & MASK64;
    h7 = (h7 + h) & MASK64;
  }

  const result = new Uint8Array(64);
  const rv = new DataView(result.buffer);
  rv.setBigUint64(0, h0, false);
  rv.setBigUint64(8, h1, false);
  rv.setBigUint64(16, h2, false);
  rv.setBigUint64(24, h3, false);
  rv.setBigUint64(32, h4, false);
  rv.setBigUint64(40, h5, false);
  rv.setBigUint64(48, h6, false);
  rv.setBigUint64(56, h7, false);

  return result;
}

// ============================================================
// Ed25519 Key Operations
// ============================================================

function clampScalar(bytes: Uint8Array): bigint {
  const clamped = new Uint8Array(bytes);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  let scalar = 0n;
  for (let i = 31; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(clamped[i]!);
  }
  return scalar;
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]!);
  }
  return result;
}

function bigIntToBytesLE(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

function ed25519PublicKey(seed: Uint8Array): Uint8Array {
  const hash = sha512(seed);
  const scalar = clampScalar(hash.slice(0, 32));
  return encodePoint(scalarMult(scalar, G));
}

function ed25519Sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  const seed = secretKey.slice(0, 32);
  const publicKey = secretKey.slice(32, 64);

  const hash = sha512(seed);
  const scalar = clampScalar(hash.slice(0, 32));
  const prefix = hash.slice(32, 64);

  // r = H(prefix || message) mod L
  const rInput = new Uint8Array(64 + message.length);
  rInput.set(prefix, 0);
  rInput.set(message, 64);
  const r = bytesToBigIntLE(sha512(rInput.slice(32))) % L;

  // R = r * G
  const R = encodePoint(scalarMult(r, G));

  // k = H(R || publicKey || message) mod L
  const kInput = new Uint8Array(64 + message.length);
  kInput.set(R, 0);
  kInput.set(publicKey, 32);
  kInput.set(message, 64);
  const k = bytesToBigIntLE(sha512(kInput)) % L;

  // s = (r + k * scalar) mod L
  const s = mod(r + k * scalar, L);

  const signature = new Uint8Array(64);
  signature.set(R, 0);
  signature.set(bigIntToBytesLE(s, 32), 32);

  return signature;
}

function ed25519Verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;

  try {
    const R = decodePoint(signature.slice(0, 32));
    const s = bytesToBigIntLE(signature.slice(32, 64));
    if (s >= L) return false;

    const A = decodePoint(publicKey);

    const kInput = new Uint8Array(64 + message.length);
    kInput.set(signature.slice(0, 32), 0);
    kInput.set(publicKey, 32);
    kInput.set(message, 64);
    const k = bytesToBigIntLE(sha512(kInput)) % L;

    const sG = scalarMult(s, G);
    const kA = scalarMult(k, A);
    const RkA = pointAdd(R, kA);

    const sGx = mod(sG.x * modInv(sG.z, P), P);
    const sGy = mod(sG.y * modInv(sG.z, P), P);
    const RkAx = mod(RkA.x * modInv(RkA.z, P), P);
    const RkAy = mod(RkA.y * modInv(RkA.z, P), P);

    return sGx === RkAx && sGy === RkAy;
  } catch {
    return false;
  }
}

// ============================================================
// Base58 Encoding/Decoding
// ============================================================

const BASE58_MAP = new Map<string, number>();
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  BASE58_MAP.set(BASE58_ALPHABET[i]!, i);
}

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let zeros = 0;
  for (const b of bytes) {
    if (b === 0) zeros++;
    else break;
  }

  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  let result = "";
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }

  return "1".repeat(zeros) + result;
}

function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);

  let zeros = 0;
  for (const c of str) {
    if (c === "1") zeros++;
    else break;
  }

  let num = 0n;
  for (const c of str) {
    const value = BASE58_MAP.get(c);
    if (value === undefined) {
      throw new Error(`Invalid Base58 character: '${c}'`);
    }
    num = num * 58n + BigInt(value);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }

  const result = new Uint8Array(zeros + bytes.length);
  result.set(bytes, zeros);
  return result;
}

// ============================================================
// RPC Types
// ============================================================

interface BalanceResponse {
  value: number;
}

interface BlockhashResponse {
  value: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

interface SignatureStatus {
  slot: number;
  confirmations: number | null;
  err: unknown;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

interface SignatureStatusesResponse {
  value: (SignatureStatus | null)[];
}

interface TransactionInstruction {
  programId: Uint8Array;
  keys: Array<{
    pubkey: Uint8Array;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Uint8Array;
}

// ============================================================
// SolanaWalletService
// ============================================================

/**
 * Solana wallet service for generating, managing, and operating wallets.
 *
 * Provides both static methods for offline wallet operations (generation,
 * import/export, signing) and instance methods for RPC operations.
 *
 * @example
 * ```typescript
 * // Generate a new wallet
 * const wallet = SolanaWalletService.generate();
 * const address = SolanaWalletService.toBase58(wallet.publicKey);
 *
 * // Connect to devnet
 * const service = new SolanaWalletService({ rpcUrl: DEVNET_RPC_URL });
 * const balance = await service.getBalance(address);
 * ```
 */
export class SolanaWalletService {
  private readonly config: Required<SolanaConfig>;

  constructor(config: SolanaConfig) {
    this.config = {
      rpcUrl: config.rpcUrl,
      commitment: config.commitment ?? "confirmed",
      timeout: config.timeout ?? DEFAULT_RPC_TIMEOUT_MS,
    };
  }

  // ============================================================
  // Static Wallet Operations
  // ============================================================

  /**
   * Generates a new random Solana wallet using Ed25519.
   */
  static generate(): SolanaWallet {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    return SolanaWalletService.fromSeed(seed);
  }

  /**
   * Creates a wallet from a 32-byte seed.
   */
  static fromSeed(seed: Uint8Array): SolanaWallet {
    if (seed.length !== 32) {
      throw new Error(`Seed must be 32 bytes, got ${seed.length}`);
    }

    const publicKey = ed25519PublicKey(seed);
    const secretKey = new Uint8Array(SECRET_KEY_LENGTH);
    secretKey.set(seed, 0);
    secretKey.set(publicKey, 32);

    return { publicKey, secretKey };
  }

  /**
   * Generates a vanity address with specified prefix/suffix.
   */
  static async generateVanity(options: VanityOptions): Promise<VanityResult> {
    SolanaWalletService.validateVanityPattern(options.prefix, options.suffix);

    const prefix = options.prefix ?? "";
    const suffix = options.suffix ?? "";
    const ignoreCase = options.ignoreCase ?? false;

    const prefixPattern = ignoreCase ? prefix.toLowerCase() : prefix;
    const suffixPattern = ignoreCase ? suffix.toLowerCase() : suffix;

    const estimatedAttempts = estimateVanityAttempts(
      prefix,
      suffix,
      ignoreCase,
    );
    const startTime = Date.now();
    let attempts = 0;
    let lastProgressTime = startTime;
    let lastProgressAttempts = 0;

    while (true) {
      const wallet = SolanaWalletService.generate();
      let address = SolanaWalletService.toBase58(wallet.publicKey);
      attempts++;

      if (ignoreCase) address = address.toLowerCase();

      const prefixMatch =
        prefixPattern.length === 0 || address.startsWith(prefixPattern);
      const suffixMatch =
        suffixPattern.length === 0 || address.endsWith(suffixPattern);

      if (prefixMatch && suffixMatch) {
        return { wallet, attempts, durationMs: Date.now() - startTime };
      }

      if (options.onProgress && attempts % VANITY_PROGRESS_INTERVAL === 0) {
        const now = Date.now();
        const intervalMs = now - lastProgressTime;
        const rate =
          intervalMs > 0
            ? ((attempts - lastProgressAttempts) / intervalMs) * 1000
            : 0;
        const remaining = Math.max(0, estimatedAttempts - attempts);

        options.onProgress({
          attempts,
          rate,
          estimatedTotal: estimatedAttempts,
          estimatedTimeMs: rate > 0 ? (remaining / rate) * 1000 : Infinity,
        });

        lastProgressTime = now;
        lastProgressAttempts = attempts;
      }

      if (
        options.maxAttempts !== undefined &&
        attempts >= options.maxAttempts
      ) {
        throw new Error(`Max attempts (${options.maxAttempts}) reached`);
      }

      if (attempts % 10000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  private static validateVanityPattern(prefix?: string, suffix?: string): void {
    const validate = (pattern: string | undefined, name: string): void => {
      if (!pattern) return;

      if (pattern.length > MAX_VANITY_PATTERN_LENGTH) {
        console.warn(
          `⚠️ ${name} length ${pattern.length} exceeds max ${MAX_VANITY_PATTERN_LENGTH}`,
        );
      }

      for (const char of pattern) {
        if (!BASE58_CHARS.has(char)) {
          const hint = CONFUSED_CHARACTERS[char];
          throw new Error(
            hint
              ? `Invalid Base58 '${char}' in ${name}: ${hint}`
              : `Invalid Base58 '${char}' in ${name}`,
          );
        }
      }
    };

    validate(prefix, "prefix");
    validate(suffix, "suffix");

    if (!prefix && !suffix) {
      throw new Error("prefix or suffix required for vanity generation");
    }
  }

  /**
   * Creates a wallet from a 64-byte secret key.
   */
  static fromSecretKey(secretKey: Uint8Array): SolanaWallet {
    if (secretKey.length !== SECRET_KEY_LENGTH) {
      throw new Error(`Secret key must be ${SECRET_KEY_LENGTH} bytes`);
    }

    const seed = secretKey.slice(0, 32);
    const storedPubkey = secretKey.slice(32, 64);
    const derivedPubkey = ed25519PublicKey(seed);

    for (let i = 0; i < 32; i++) {
      if (storedPubkey[i] !== derivedPubkey[i]) {
        throw new Error("Invalid secret key: public key mismatch");
      }
    }

    return {
      publicKey: storedPubkey.slice(),
      secretKey: secretKey.slice(),
    };
  }

  /**
   * Creates a wallet from Solana CLI export format.
   */
  static fromExport(exported: SolanaWalletExport): SolanaWallet {
    return SolanaWalletService.fromSecretKey(
      new Uint8Array(exported.secretKey),
    );
  }

  /**
   * Exports wallet to Solana CLI compatible format.
   */
  static toExport(wallet: SolanaWallet): SolanaWalletExport {
    return {
      publicKey: SolanaWalletService.toBase58(wallet.publicKey),
      secretKey: Array.from(wallet.secretKey),
    };
  }

  /**
   * Validates a Solana address.
   */
  static isValidAddress(address: string): AddressValidation {
    if (
      address.length < ADDRESS_MIN_LENGTH ||
      address.length > ADDRESS_MAX_LENGTH
    ) {
      return { valid: false, error: `Invalid length: ${address.length}` };
    }

    for (const char of address) {
      if (!BASE58_CHARS.has(char)) {
        return { valid: false, error: `Invalid character: '${char}'` };
      }
    }

    try {
      const decoded = base58Decode(address);
      if (decoded.length !== PUBLIC_KEY_LENGTH) {
        return {
          valid: false,
          error: `Decoded ${decoded.length} bytes, need ${PUBLIC_KEY_LENGTH}`,
        };
      }
      return { valid: true, publicKey: decoded };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  /**
   * Gets the public key of a wallet as a Base58 string.
   * @param wallet - The wallet to get the public key from
   * @returns The public key as a Base58 encoded string (the wallet address)
   */
  static getPublicKeyBase58(wallet: SolanaWallet): string {
    return base58Encode(wallet.publicKey);
  }

  /**
   * Encodes bytes to Base58.
   */
  static toBase58(bytes: Uint8Array): string {
    return base58Encode(bytes);
  }

  /**
   * Decodes Base58 to bytes.
   */
  static fromBase58(str: string): Uint8Array {
    return base58Decode(str);
  }

  /**
   * Signs a message with Ed25519.
   */
  static sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    if (secretKey.length !== SECRET_KEY_LENGTH) {
      throw new Error(`Secret key must be ${SECRET_KEY_LENGTH} bytes`);
    }
    return ed25519Sign(message, secretKey);
  }

  /**
   * Verifies an Ed25519 signature.
   */
  static verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ): boolean {
    return ed25519Verify(message, signature, publicKey);
  }

  /**
   * Securely clears wallet secret key from memory.
   */
  static zeroize(wallet: SolanaWallet): void {
    wallet.secretKey.fill(0);
    crypto.getRandomValues(wallet.secretKey);
    wallet.secretKey.fill(0);
  }

  /**
   * Clears sensitive data from a buffer.
   */
  static clearSensitiveData(data: Uint8Array): void {
    data.fill(0);
    crypto.getRandomValues(data);
    data.fill(0);
  }

  // ============================================================
  // RPC Operations
  // ============================================================

  /**
   * Gets the balance of an account.
   */
  async getBalance(publicKey: string | Uint8Array): Promise<SolanaBalance> {
    const address =
      typeof publicKey === "string"
        ? publicKey
        : SolanaWalletService.toBase58(publicKey);

    const response = (await this.rpcRequest("getBalance", [
      address,
      { commitment: this.config.commitment },
    ])) as BalanceResponse;

    const lamports = BigInt(response.value);
    return {
      sol: lamportsToSol(lamports),
      lamports: lamports.toString(),
    };
  }

  /**
   * Transfers SOL between accounts.
   */
  async transfer(
    wallet: SolanaWallet,
    request: TransferRequest,
  ): Promise<TransferResult> {
    const validation = SolanaWalletService.isValidAddress(request.to);
    if (!validation.valid) {
      throw new Error(`Invalid recipient: ${validation.error}`);
    }

    this.warnIfMainnet("transfer");

    const { blockhash } = await this.getRecentBlockhash();
    const toPubkey = SolanaWalletService.fromBase58(request.to);
    const lamports = BigInt(request.lamports);

    // Build System Program transfer instruction
    const instruction = this.buildTransferInstruction(
      wallet.publicKey,
      toPubkey,
      lamports,
    );

    // Build and sign transaction
    const message = this.buildMessage(blockhash, wallet.publicKey, [
      instruction,
    ]);
    const signature = SolanaWalletService.sign(message, wallet.secretKey);
    const serialized = this.serializeTransaction(signature, message);

    // Send
    const txSig = (await this.rpcRequest("sendTransaction", [
      this.toBase64(serialized),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: this.config.commitment,
        maxRetries: 3,
      },
    ])) as string;

    const confirmed = await this.confirmTransaction(txSig);

    return {
      signature: txSig,
      status: confirmed ? "confirmed" : "pending",
    };
  }

  private buildTransferInstruction(
    from: Uint8Array,
    to: Uint8Array,
    lamports: bigint,
  ): TransactionInstruction {
    const systemProgram = new Uint8Array(32); // All zeros = System Program

    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true); // Transfer = instruction 2
    view.setBigUint64(4, lamports, true);

    return {
      programId: systemProgram,
      keys: [
        { pubkey: from, isSigner: true, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: true },
      ],
      data,
    };
  }

  private buildMessage(
    blockhash: string,
    feePayer: Uint8Array,
    instructions: TransactionInstruction[],
  ): Uint8Array {
    const encodeCompact = (len: number): Uint8Array => {
      const bytes: number[] = [];
      let val = len;
      do {
        let elem = val & 0x7f;
        val >>= 7;
        if (val !== 0) elem |= 0x80;
        bytes.push(elem);
      } while (val !== 0);
      return new Uint8Array(bytes);
    };

    // Collect accounts
    const accountsMap = new Map<
      string,
      { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }
    >();

    const feePayerKey = SolanaWalletService.toBase58(feePayer);
    accountsMap.set(feePayerKey, {
      pubkey: feePayer,
      isSigner: true,
      isWritable: true,
    });

    for (const ix of instructions) {
      for (const key of ix.keys) {
        const keyStr = SolanaWalletService.toBase58(key.pubkey);
        const existing = accountsMap.get(keyStr);
        if (existing) {
          existing.isSigner = existing.isSigner || key.isSigner;
          existing.isWritable = existing.isWritable || key.isWritable;
        } else {
          accountsMap.set(keyStr, { ...key });
        }
      }

      const progKey = SolanaWalletService.toBase58(ix.programId);
      if (!accountsMap.has(progKey)) {
        accountsMap.set(progKey, {
          pubkey: ix.programId,
          isSigner: false,
          isWritable: false,
        });
      }
    }

    // Sort: signers first, then writable, then readonly
    const accounts = Array.from(accountsMap.values()).sort((a, b) => {
      if (a.isSigner !== b.isSigner) return a.isSigner ? -1 : 1;
      if (a.isWritable !== b.isWritable) return a.isWritable ? -1 : 1;
      return 0;
    });

    const accountIndex = new Map<string, number>();
    accounts.forEach((acc, i) => {
      accountIndex.set(SolanaWalletService.toBase58(acc.pubkey), i);
    });

    let numSigners = 0,
      numReadonlySigners = 0,
      numReadonlyUnsigned = 0;
    for (const acc of accounts) {
      if (acc.isSigner) {
        numSigners++;
        if (!acc.isWritable) numReadonlySigners++;
      } else if (!acc.isWritable) {
        numReadonlyUnsigned++;
      }
    }

    const parts: Uint8Array[] = [];

    // Header
    parts.push(
      new Uint8Array([numSigners, numReadonlySigners, numReadonlyUnsigned]),
    );

    // Accounts
    parts.push(encodeCompact(accounts.length));
    for (const acc of accounts) parts.push(acc.pubkey);

    // Recent blockhash
    parts.push(SolanaWalletService.fromBase58(blockhash));

    // Instructions
    parts.push(encodeCompact(instructions.length));
    for (const ix of instructions) {
      parts.push(
        new Uint8Array([
          accountIndex.get(SolanaWalletService.toBase58(ix.programId))!,
        ]),
      );

      parts.push(encodeCompact(ix.keys.length));
      for (const key of ix.keys) {
        parts.push(
          new Uint8Array([
            accountIndex.get(SolanaWalletService.toBase58(key.pubkey))!,
          ]),
        );
      }

      parts.push(encodeCompact(ix.data.length));
      parts.push(ix.data);
    }

    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      message.set(part, offset);
      offset += part.length;
    }

    return message;
  }

  private serializeTransaction(
    signature: Uint8Array,
    message: Uint8Array,
  ): Uint8Array {
    const tx = new Uint8Array(1 + 64 + message.length);
    tx[0] = 1; // 1 signature
    tx.set(signature, 1);
    tx.set(message, 65);
    return tx;
  }

  private toBase64(bytes: Uint8Array): string {
    if (typeof btoa === "function") {
      return btoa(String.fromCharCode(...bytes));
    }
    return Buffer.from(bytes).toString("base64");
  }

  /**
   * Requests an airdrop (devnet/testnet only).
   */
  async requestAirdrop(
    publicKey: string | Uint8Array,
    lamports: string,
  ): Promise<AirdropResult> {
    if (this.config.rpcUrl.includes("mainnet")) {
      throw new Error("Airdrops not available on mainnet");
    }

    const address =
      typeof publicKey === "string"
        ? publicKey
        : SolanaWalletService.toBase58(publicKey);

    const signature = (await this.rpcRequest("requestAirdrop", [
      address,
      parseInt(lamports, 10),
    ])) as string;

    console.info(`💧 Airdrop: ${lamportsToSol(lamports)} SOL → ${address}`);
    return { signature, lamports };
  }

  /**
   * Gets recent blockhash.
   */
  async getRecentBlockhash(): Promise<BlockhashInfo> {
    const response = (await this.rpcRequest("getLatestBlockhash", [
      { commitment: this.config.commitment },
    ])) as BlockhashResponse;

    return {
      blockhash: response.value.blockhash,
      lastValidBlockHeight: response.value.lastValidBlockHeight,
    };
  }

  /**
   * Confirms a transaction.
   */
  async confirmTransaction(
    signature: string,
    commitment?: SolanaCommitment,
  ): Promise<boolean> {
    const response = (await this.rpcRequest("getSignatureStatuses", [
      [signature],
    ])) as SignatureStatusesResponse;

    const status = response.value[0];
    if (!status) return false;

    const required = commitment ?? this.config.commitment;
    if (required === "finalized")
      return status.confirmationStatus === "finalized";
    if (required === "confirmed") {
      return (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      );
    }
    return status.confirmationStatus !== null;
  }

  private async rpcRequest(
    method: string,
    params: unknown[],
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(this.config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`RPC failed: ${res.status}`);

      const json = (await res.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (json.error)
        throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
      return json.result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private warnIfMainnet(op: string): void {
    if (this.config.rpcUrl.includes("mainnet")) {
      console.warn(`⚠️ ${op} on MAINNET - REAL FUNDS AT RISK`);
    }
  }

  // ============================================================
  // Factory Methods
  // ============================================================

  static forCluster(
    cluster: SolanaCluster,
    options?: Omit<SolanaConfig, "rpcUrl">,
  ): SolanaWalletService {
    const rpcUrl = getClusterUrl(cluster);
    if (isMainnetCluster(cluster)) {
      console.warn("⚠️ Connected to MAINNET - REAL FUNDS AT RISK");
    }
    return new SolanaWalletService({ rpcUrl, ...options });
  }

  canAirdrop(): boolean {
    return !this.config.rpcUrl.includes("mainnet");
  }

  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  getCommitment(): SolanaCommitment {
    return this.config.commitment;
  }
}

// Re-export types
export type {
  SolanaWallet,
  SolanaWalletExport,
  SolanaConfig,
  SolanaBalance,
  TransferRequest,
  TransferResult,
  VanityOptions,
  VanityResult,
  VanityProgress,
  AirdropResult,
  BlockhashInfo,
  AddressValidation,
  SolanaCommitment,
  SolanaCluster,
};
