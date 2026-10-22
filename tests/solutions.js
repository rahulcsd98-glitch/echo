// ---------------------------------------------------------------------------
// Scripted solutions. Each entry is a flat list of steps:
//   [keys, ticks]  keys held for that many ticks (J jumps on the first tick,
//                  E interacts, G grabs, S sprints)
//   ['REST', n]    rewind the room: the attempt becomes an echo
//   ['DIE', n]     idle n ticks (used when a death is expected)
// These run against the real simulation in tests/headless.js.
// ---------------------------------------------------------------------------

export const SOLUTIONS = {
  // Walk onto the plate, rewind, then wait for your echo and cross.
  1: [['R', 40], ['', 900], ['REST', 0], ['', 200], ['R', 520]],

  // Fall into the pit, land on the plate. Then jump the pit.
  2: [['R', 80], ['', 900], ['REST', 0], ['', 150], ['R', 45], ['RJ', 420]],

  // Hold the first button forever; press the timed one on the way through.
  3: [['R', 30], ['E', 1500], ['REST', 0], ['', 120], ['R', 142], ['', 45], ['E', 6], ['', 20], ['R', 320]],

  // Echo holds the plate; ride platform A, transfer to B, walk the catwalk.
  4: [
    ['R', 26],
    ['', 1500],
    ['REST', 0],
    ['R', 60],
    ['', 80],
    ['R', 10],
    ['', 210],
    ['R', 130],
  ],

  // Echo holds the plate behind the sentinel; push the box down the hall.
  5: [['R', 45], ['', 900], ['REST', 0], ['', 60], ['R', 900]],

  // Lure the guard over the trench it cannot climb out of, then walk out.
  6: [
    ['RS', 12],
    ['RSJ', 30],
    ['RS', 140],
    ['', 900],
    ['REST', 0],
    ['', 200],
    ['RS', 12],
    ['RSJ', 30],
    ['RS', 200],
  ],

  // Two plates, two echoes, then the exit.
  7: [
    ['R', 26],
    ['', 1200],
    ['REST', 0],
    ['R', 155],
    ['', 1200],
    ['REST', 0],
    ['RS', 320],
  ],

  // Echo exists (gate). Carry each box onto its plate, then leave.
  8: [
    ['', 2000],
    ['REST', 0],
    ['R', 46],
    ['GJ', 4],
    ['R', 24],
    ['R', 60],
    ['G', 4],
    ['R', 46],
    ['GJ', 4],
    ['R', 24],
    ['RS', 200],
  ],

  // Two pulses latch the relay; then box-on-plate and a held plate.
  9: [
    ['R', 30],
    ['E', 6],
    ['', 130],
    ['E', 6],
    ['', 260],
    ['REST', 0],
    ['', 170],
    ['R', 100],
    ['G', 4],
    ['R', 45],
    ['LG', 3],
    ['R', 95],
    ['', 1400],
    ['REST', 0],
    ['', 300],
    ['RS', 102],
    ['RJ', 32],
    ['RS', 140],
  ],

  // Echo carries the box to the ledge; then take the box away and let it fall apart.
  10: [
    ['R', 38],
    ['G', 4],
    ['R', 88],
    ['G', 4],
    ['R', 8],
    ['RJ', 60],
    ['R', 30],
    ['', 1500],
    ['REST', 0],
    ['R', 38],
    ['G', 4],
    ['', 20],
    ['R', 88],
    ['R', 8],
    ['RJ', 60],
    ['R', 60],
    ['RS', 400],
  ],

  // Echo holds the plate under a beam, eroded and kept alive by the field.
  11: [
    ['R', 88],
    ['E', 6],
    ['', 40],
    ['R', 46],
    ['', 1500],
    ['REST', 0],
    ['', 120],
    ['RS', 320],
  ],

  // Echo holds the plate; press the dampener before the hunter arrives.
  12: [
    ['R', 45],
    ['', 1800],
    ['REST', 0],
    ['', 40],
    ['R', 205],
    ['E', 6],
    ['', 20],
    ['RS', 260],
  ],

  // Echo holds the plate; box onto the gantry to shade the beam, then ride up.
  13: [
    ['R', 40],
    ['', 1500],
    ['REST', 0],
    ['R', 68],
    ['G', 4],
    ['R', 44],
    ['J', 1],
    ['R', 21],
    ['', 6],
    ['G', 4],
    ['L', 24],
    ['R', 75],
    ['', 120],
    ['R', 90],
  ],

  // Three plates, a gate that counts two echoes.
  14: [
    ['R', 30],
    ['', 1500],
    ['REST', 0],
    ['R', 110],
    ['', 1500],
    ['REST', 0],
    ['R', 220],
    ['', 1500],
    ['REST', 0],
    ['RS', 340],
  ],

  // Steal the box it expects (corrupting it), then stabilise it and leave.
  15: [
    ['R', 12],
    ['G', 4],
    ['R', 80],
    ['G', 4],
    ['L', 60],
    ['', 1500],
    ['REST', 0],
    ['R', 120],
    ['G', 4],
    ['R', 46],
    ['E', 6],
    ['', 30],
    ['R', 60],
    ['RJ', 40],
    ['', 20],
    ['R', 14],
    ['G', 4],
    ['', 20],
    ['RS', 360],
  ],
};
