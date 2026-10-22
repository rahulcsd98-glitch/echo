// Level authoring helpers. Maps are built from a small vocabulary so the
// geometry stays readable and border errors are impossible.
//
//   '#' wall   'v' void/death   '^' spikes   '=' one-way platform
//   ':' deco strip   '~' pipe   'o' vent   '-' trim
//   'p' spawn   'E' exit
const at = (n) => '.'.repeat(n);
const full = (c, n) => c.repeat(n);
const R = (w, s = '') => '#' + s.padEnd(w - 2, '.').slice(0, w - 2) + '#';
const solid = (w, c = '#') => R(w, full(c, w - 2));

/**
 * Build a room: solid border, open interior, two solid floor rows at the
 * bottom. Any row can be overridden with `spec[row] = innerContent`.
 */
export function room(w, h, spec = {}, floorFrom = h - 2) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const s = spec[y];
    if (s !== undefined) rows.push(R(w, s));
    else if (y === 0 || y >= floorFrom) rows.push(solid(w));
    else rows.push(R(w, ''));
  }
  return rows;
}

export const helpers = { at, full, R, solid };
export { at, full };
