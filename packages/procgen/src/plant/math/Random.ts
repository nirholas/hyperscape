/**
 * Seeded random number generator.
 *
 * Re-exports consolidated RNG from main math module for plant generation.
 * All implementations now use the same Mersenne Twister algorithm.
 */

export {
  SeededRandom,
  setGlobalSeed,
  getGlobalRandom,
  genTypedSeed,
} from "../../math/Random.js";
