import { TILE } from './constants.js';

// Tile ids used by the parsed level grid.
export const TILE_EMPTY = 0;
export const TILE_WALL = 1;
export const TILE_VOID = 2; // lethal nothing
export const TILE_SPIKE = 3; // lethal, not solid
export const TILE_ONEWAY = 4; // solid only when landed on from above
export const TILE_STRIP = 5; // deco
export const TILE_PIPE = 6; // deco
export const TILE_VENT = 7; // deco
export const TILE_TRIM = 8; // deco, wall-adjacent plate

export const TILE_CHARS = {
  '#': TILE_WALL,
  '.': TILE_EMPTY,
  v: TILE_VOID,
  '^': TILE_SPIKE,
  '=': TILE_ONEWAY,
  ':': TILE_STRIP,
  '~': TILE_PIPE,
  o: TILE_VENT,
  '-': TILE_TRIM,
};

export function isSolidId(id) {
  return id === TILE_WALL;
}
export function isLethalId(id) {
  return id === TILE_VOID || id === TILE_SPIKE;
}

export class Grid {
  constructor(w, h, cells) {
    this.w = w;
    this.h = h;
    this.cells = cells; // Uint8Array
    this.pxWidth = w * TILE;
    this.pxHeight = h * TILE;
  }

  at(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return TILE_WALL;
    return this.cells[ty * this.w + tx];
  }

  solidTile(tx, ty) {
    return isSolidId(this.at(tx, ty));
  }

  solidAtPoint(px, py) {
    return this.solidTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  lethalAtPoint(px, py) {
    return isLethalId(this.at(Math.floor(px / TILE), Math.floor(py / TILE)));
  }

  lethalAtRect(x, y, w, h) {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isLethalId(this.at(tx, ty))) return true;
      }
    }
    return false;
  }

  // Solid walls overlapping a rect (one-way platforms excluded on purpose).
  overlapsSolid(x, y, w, h) {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.solidTile(tx, ty)) return true;
      }
    }
    return false;
  }

  // Returns true if any tile matched a predicate along the segment (exclusive of start).
  raycast(x0, y0, dx, dy, len, predicate, step = 3) {
    const steps = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * len;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      if (predicate(tx, ty, px, py)) return t;
    }
    return -1;
  }
}

// Standalone so levels can be inspected before a Grid exists.
export function parseMap(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cells = new Uint8Array(w * h);
  const spawns = [];
  const exits = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '.';
      if (ch === 'p') {
        cells[y * w + x] = TILE_EMPTY;
        spawns.push({ tx: x, ty: y });
      } else if (ch === 'E') {
        cells[y * w + x] = TILE_EMPTY;
        exits.push({ tx: x, ty: y });
      } else {
        cells[y * w + x] = TILE_CHARS[ch] ?? TILE_EMPTY;
      }
    }
  }
  return { w, h, cells, spawns, exits };
}
