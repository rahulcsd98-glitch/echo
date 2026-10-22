// Art direction: near-black machine rooms with a single luminous accent per
// room. Colour is information - the strongest accent is you, the coolest is the
// machinery, the secondary is your past, red is what wants you dead.
export const PALETTES = [
  {
    // 01 CALIBRATION - cold lab steel, cyan signature
    name: 'CALIBRATION',
    void: '#05070b',
    voidDeep: '#010204',
    haze: '#0b1724',
    wall: '#151b26',
    wallFace: '#1e2735',
    wallEdge: '#33415a',
    trim: '#4a5b78',
    interact: '#6fe8ff',
    player: '#eafcff',
    suit: '#9fe9ff',
    echo: '#4fb6ff',
    energy: '#57f0d4',
    danger: '#ff5a4d',
    warn: '#ffb347',
    corrupt: '#b26bff',
  },
  {
    // 02 CASCADE - violet basalt
    name: 'CASCADE',
    void: '#070610',
    voidDeep: '#020205',
    haze: '#171034',
    wall: '#1a1730',
    wallFace: '#241f42',
    wallEdge: '#3d3468',
    trim: '#5b4f94',
    interact: '#8fd0ff',
    player: '#fbeeff',
    suit: '#cfa6ff',
    echo: '#9a7dff',
    energy: '#6fe8ff',
    danger: '#ff6a5a',
    warn: '#ffc45e',
    corrupt: '#ff5fd2',
  },
  {
    // 03 SIGNAL - mossy machine hall
    name: 'SIGNAL',
    void: '#040806',
    voidDeep: '#010302',
    haze: '#0c1f18',
    wall: '#131f1b',
    wallFace: '#1c2c26',
    wallEdge: '#33493f',
    trim: '#4d6b5c',
    interact: '#7dffb0',
    player: '#f2fff8',
    suit: '#9df0c9',
    echo: '#5fd6ff',
    energy: '#c9ff5e',
    danger: '#ff6b4a',
    warn: '#ffd166',
    corrupt: '#c86bff',
  },
  {
    // 04 LATCH - amber foundry
    name: 'LATCH',
    void: '#0a0703',
    voidDeep: '#030201',
    haze: '#241605',
    wall: '#221a12',
    wallFace: '#2e2418',
    wallEdge: '#4d3d24',
    trim: '#6d5734',
    interact: '#ffce7a',
    player: '#fff6e2',
    suit: '#ffcf8a',
    echo: '#7fe3ff',
    energy: '#ffa53d',
    danger: '#ff4d3d',
    warn: '#ffd166',
    corrupt: '#a06bff',
  },
  {
    // 05 PREDATOR - deep rust predawn
    name: 'PREDATOR',
    void: '#0b0406',
    voidDeep: '#030102',
    haze: '#2a0a10',
    wall: '#231519',
    wallFace: '#311d23',
    wallEdge: '#543038',
    trim: '#75454f',
    interact: '#ff8f7a',
    player: '#ffe9e4',
    suit: '#ffb0a0',
    echo: '#63d9ff',
    energy: '#ff7a54',
    danger: '#ff3b30',
    warn: '#ffc65e',
    corrupt: '#e05fff',
  },
  {
    // 06 ECHO//SHIFT - the room remembers everything
    name: 'ECHO//SHIFT',
    void: '#050510',
    voidDeep: '#010108',
    haze: '#141034',
    wall: '#151329',
    wallFace: '#1e1b3a',
    wallEdge: '#39326b',
    trim: '#574d9b',
    interact: '#8be9ff',
    player: '#ffffff',
    suit: '#b9f4ff',
    echo: '#ff7ad9',
    energy: '#6ff0ff',
    danger: '#ff5566',
    warn: '#ffd166',
    corrupt: '#c07bff',
  },
];

export function paletteFor(index) {
  return PALETTES[(index | 0) % PALETTES.length] || PALETTES[0];
}

// 'rgba()' helper from a #rrggbb string so palettes stay readable as hex.
export function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mixHex(a, b, t) {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t);
  const g = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t);
  const bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}
