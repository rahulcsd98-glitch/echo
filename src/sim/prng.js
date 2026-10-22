// Deterministic PRNG. The simulation never uses Math.random:
// every random value comes from a world-owned stream so replays match.
export class Rng {
  constructor(seed = 1) {
    this.s = (seed | 0) || 1;
  }
  next() {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return ((x >>> 0) % 100000) / 100000;
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
}

// Stable 32-bit hash used for world-state signatures (divergence detection).
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashInts(values) {
  let h = 2166136261;
  for (let i = 0; i < values.length; i++) {
    h ^= values[i] | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
