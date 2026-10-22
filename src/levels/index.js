import { at, full, room } from './helpers.js';

// ---------------------------------------------------------------------------
// The run. Each room teaches one idea, then leans on the ones before it.
// Coordinates are tiles (24px). floorFrom = 12, so the standing surface is
// y = 288; a 1-tile step is 24px, a full jump is ~56px.
// ---------------------------------------------------------------------------

const P = (text, x, y, when = 'start', delay = 0) => ({ text, x, y, when, delay });

export const LEVELS = [
  // ------------------------------------------------------------------ 01 ---
  {
    id: 1,
    name: 'HANDSHAKE',
    subtitle: 'the room remembers',
    palette: 0,
    maxEchoes: 2,
    par: 2,
    hint: 'THE DOOR CLOSES BEFORE YOU GET THERE',
    map: room(36, 14, { 11: at(3) + 'p' }),
    exit: { tx: 30, ty: 11 },
    objects: [
      { type: 'plate', x: 8, y: 11, w: 2, channel: 'a' },
      { type: 'door', x: 18, y: 9, h: 3, channel: 'a' },
    ],
    prompts: [
      P('MOVE   A / D', 12, 8, 'start'),
      P('[R] REWIND THE ROOM', 12, 6, 'start', 200),
      P('IT REMEMBERS YOU', 20, 8, 'after-echo'),
    ],
  },

  // ------------------------------------------------------------------ 02 ---
  {
    id: 2,
    name: 'LEVERAGE',
    subtitle: 'somewhere you cannot leave',
    palette: 0,
    maxEchoes: 2,
    par: 2,
    hint: 'A PAST SELF CAN STAY WHERE YOU CANNOT',
    map: room(
      36,
      16,
      {
        11: at(3) + 'p',
        12: full('#', 9) + at(3) + full('#', 22),
        13: full('#', 9) + at(3) + full('#', 22),
        14: full('#', 9) + at(3) + full('#', 22),
      },
      12
    ),
    exit: { tx: 32, ty: 11 },
    objects: [
      { type: 'plate', x: 10, y: 14, w: 3, channel: 'a' },
      { type: 'door', x: 20, y: 9, h: 3, channel: 'a' },
    ],
    prompts: [P('[R] REWIND', 16, 10, 'start', 260)],
  },

  // ------------------------------------------------------------------ 03 ---
  {
    id: 3,
    name: 'SEQUENCE',
    subtitle: 'hold, then release',
    palette: 1,
    maxEchoes: 2,
    par: 2,
    hint: 'A HELD BUTTON IS A PERSON WHO CANNOT MOVE',
    map: room(36, 14, { 11: at(2) + 'p' }),
    exit: { tx: 33, ty: 11 },
    objects: [
      { type: 'button', x: 7, y: 10, channel: 'a', mode: 'hold' },
      { type: 'door', x: 14, y: 9, h: 3, channel: 'a' },
      { type: 'button', x: 22, y: 10, channel: 'b', mode: 'timed', duration: 700 },
      { type: 'door', x: 28, y: 9, h: 3, channel: 'b' },
    ],
    prompts: [P('HOLD  [E]', 7, 8, 'start'), P('TIMED - IT LETS GO', 22, 8, 'start', 600)],
  },

  // ------------------------------------------------------------------ 04 ---
  {
    id: 4,
    name: 'INTERVAL',
    subtitle: 'two machines, one window',
    palette: 1,
    maxEchoes: 2,
    par: 2,
    hint: 'RIDE THE ONE THAT MEETS THE OTHER',
    map: room(
      36,
      16,
      {
        5: at(20) + full('#', 14),
        11: at(1) + 'p',
        12: full('#', 8) + full('v', 19) + full('#', 7),
        13: full('#', 8) + full('v', 19) + full('#', 7),
      },
      12
    ),
    exit: { tx: 33, ty: 4 },
    objects: [
      { type: 'plate', x: 4, y: 11, w: 2, channel: 'a' },
      // both machines dwell at the far end of their run: the transfer window
      // is long enough to read, short enough to matter
      { type: 'platform', x: 8, y: 12, w: 3, to: [16, 12], period: 400, travel: 0.35 },
      { type: 'platform', x: 18, y: 12, w: 3, to: [18, 5], period: 400, phase: 0.5, travel: 0.35 },
      { type: 'gate', x: 31, y: 3, h: 3, channel: 'a' },
    ],
    prompts: [P('RIDE IT', 9, 9, 'start'), P('ONE MACHINE HANDS YOU TO THE OTHER', 8, 7, 'start', 900)],
  },

  // ------------------------------------------------------------------ 05 ---
  {
    id: 5,
    name: 'COVER',
    subtitle: 'it cannot see through what it cannot move',
    palette: 1,
    maxEchoes: 2,
    par: 2,
    hint: 'BEHIND A BOX YOU DO NOT EXIST',
    map: room(44, 14, { 11: at(1) + 'p' }),
    exit: { tx: 41, ty: 11 },
    objects: [
      { type: 'plate', x: 7, y: 11, w: 2, channel: 'a' },
      { type: 'gate', x: 30, y: 9, h: 3, channel: 'a' },
    ],
    entities: [
      { type: 'box', x: 10, y: 11 },
      { type: 'sentinel', x: 38, y: 9, angle: 3.1416, sweep: 0.3, period: 320, range: 20 },
    ],
    prompts: [P('IT SEES EVERYTHING IN FRONT OF IT', 26, 7, 'start', 150)],
  },

  // ------------------------------------------------------------------ 06 ---
  {
    id: 6,
    name: 'DIVERSION',
    subtitle: 'it only ever watches one of you',
    palette: 2,
    maxEchoes: 2,
    par: 2,
    hint: 'IT CANNOT JUMP WHAT YOU CAN',
    // A two-deep service trench splits the corridor. You clear it; it does not.
    map: room(
      48,
      14,
      {
        11: at(11) + 'p' + at(34),
        12: full('#', 14) + at(3) + full('#', 29),
      },
      12
    ),
    exit: { tx: 46, ty: 11 },
    objects: [{ type: 'gate', x: 40, y: 9, h: 3, echoes: 1 }],
    entities: [{ type: 'guard', x: 4, y: 11, from: 1, to: 10, vision: 150 }],
    prompts: [
      P('IT KILLS. YOUR ECHOES IT ONLY UNRAVELS.', 8, 8, 'start', 400),
      P('MEET IT AT THE TRENCH', 13, 7, 'start', 1100),
    ],
  },

  // ------------------------------------------------------------------ 07 ---
  {
    id: 7,
    name: 'DUET',
    subtitle: 'one you is not enough',
    palette: 2,
    maxEchoes: 2,
    par: 3,
    hint: 'ONE ECHO PER PLATE',
    map: room(44, 14, { 11: at(1) + 'p' }),
    exit: { tx: 42, ty: 11 },
    objects: [
      { type: 'plate', x: 5, y: 11, w: 2, channel: 'a' },
      { type: 'door', x: 14, y: 9, h: 3, channel: 'a' },
      { type: 'plate', x: 22, y: 11, w: 2, channel: 'b' },
      { type: 'door', x: 32, y: 9, h: 3, channel: 'b' },
    ],
    prompts: [P('A SAID  [R]  IS NOT A MISTAKE', 16, 7, 'start', 800)],
  },

  // ------------------------------------------------------------------ 08 ---
  {
    id: 8,
    name: 'MASS',
    subtitle: 'weight never forgets',
    palette: 2,
    maxEchoes: 2,
    par: 2,
    hint: 'A BOX ON A PLATE STAYS FOREVER',
    map: room(48, 16, { 11: at(1) + 'p' }, 12),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'plate', x: 8, y: 11, w: 4, channel: 'a' },
      { type: 'door', x: 16, y: 9, h: 3, channel: 'a' },
      { type: 'plate', x: 25, y: 11, w: 4, channel: 'b' },
      { type: 'door', x: 36, y: 9, h: 3, channel: 'b' },
      { type: 'gate', x: 42, y: 9, h: 3, echoes: 1 },
    ],
    entities: [
      { type: 'box', x: 5, y: 11 },
      { type: 'box', x: 20, y: 11 },
    ],
    prompts: [P('[G] LIFT   [G] DROP', 20, 8, 'start', 500)],
  },

  // ------------------------------------------------------------------ 09 ---
  {
    id: 9,
    name: 'LATCH',
    subtitle: 'a pulse is not a promise',
    palette: 3,
    maxEchoes: 3,
    par: 3,
    hint: 'SOME SIGNALS HAVE TO BE CAUGHT TWICE',
    map: room(48, 16, { 11: at(2) + 'p' }, 12),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'button', x: 6, y: 11, channel: 'h', mode: 'timed', duration: 90 },
      { type: 'relay', x: 9, y: 11, channel: 'r', input: 'h', div: 2 },
      { type: 'gate', x: 13, y: 9, h: 3, channel: 'r' },
      { type: 'plate', x: 20, y: 11, w: 4, channel: 'a' },
      { type: 'door', x: 26, y: 9, h: 3, channel: 'a' },
      { type: 'plate', x: 34, y: 11, w: 3, channel: 'b' },
      { type: 'door', x: 40, y: 9, h: 3, channel: 'b' },
    ],
    entities: [{ type: 'box', x: 16, y: 11 }],
    prompts: [P('TWO PULSES, ONE LATCH', 9, 7, 'start', 500)],
  },

  // ------------------------------------------------------------------ 10 ---
  {
    id: 10,
    name: 'DIVERGENCE',
    subtitle: 'what you take from the past',
    palette: 3,
    maxEchoes: 3,
    par: 2,
    hint: 'THE GATE OPENS FOR INSTABILITY, NOT ORDER',
    map: room(
      48,
      16,
      {
        10: at(20) + full('#', 8),
        11: at(1) + 'p' + at(19) + full('#', 8),
      },
      12
    ),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'plate', x: 24, y: 9, w: 2, channel: 'a' },
      { type: 'door', x: 32, y: 9, h: 3, channel: 'a' },
      { type: 'gate', x: 40, y: 9, h: 3, corrupt: 1 },
    ],
    entities: [{ type: 'box', x: 8, y: 11 }],
    prompts: [P('IT EXPECTS THE BOX. TAKE IT ANYWAY.', 14, 8, 'start', 1000)],
  },

  // ------------------------------------------------------------------ 11 ---
  {
    id: 11,
    name: 'DECAY',
    subtitle: 'the field restores what the beam erodes',
    palette: 3,
    maxEchoes: 3,
    par: 2,
    hint: 'THE FIELD IS FIRST AID FOR YOUR PAST',
    map: room(48, 16, { 11: at(1) + 'p' }, 12),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'plate', x: 20, y: 11, w: 2, channel: 'a' },
      { type: 'laser', x: 21, y: 6, dir: 'down', length: 6 },
      { type: 'switch', x: 15, y: 11, channel: 'd' },
      { type: 'dampener', x: 18, y: 7, w: 6, h: 4, channel: 'd', radius: 6 },
      { type: 'door', x: 30, y: 9, h: 3, channel: 'a' },
    ],
    prompts: [
      P('THE BEAM WILL EAT IT FROM ABOVE', 20, 5, 'start', 900),
      P('SWITCH  [E]', 15, 10, 'start', 1400),
    ],
  },

  // ------------------------------------------------------------------ 12 ---
  {
    id: 12,
    name: 'PREDATOR',
    subtitle: 'it eats what you used to be',
    palette: 4,
    maxEchoes: 3,
    par: 2,
    hint: 'THE FIELD IS THE ONLY PLACE AN ECHO IS SAFE',
    map: room(48, 16, { 11: at(2) + 'p' }, 12),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'plate', x: 8, y: 11, w: 2, channel: 'a' },
      { type: 'door', x: 16, y: 9, h: 3, channel: 'a' },
      { type: 'button', x: 30, y: 10, channel: 'd', mode: 'timed', duration: 3000 },
      { type: 'dampener', x: 5, y: 8, w: 6, h: 4, channel: 'd', radius: 7 },
      { type: 'gate', x: 42, y: 9, h: 3, channel: 'd' },
    ],
    entities: [{ type: 'hunter', x: 40, y: 6 }],
    prompts: [P('PRESS IT BEFORE IT ARRIVES', 30, 8, 'start', 800)],
  },

  // ------------------------------------------------------------------ 13 ---
  {
    id: 13,
    name: 'MACHINERY',
    subtitle: 'everything at once, slowly',
    palette: 4,
    maxEchoes: 3,
    par: 2,
    hint: 'BOX FOR THE BEAM, TIMING FOR THE RIDE',
    map: room(
      48,
      16,
      {
        5: at(29) + full('#', 7),
        10: at(19) + full('=', 3),
        11: at(1) + 'p',
        12: full('#', 24) + full('v', 6) + full('#', 17),
        13: full('#', 24) + full('v', 6) + full('#', 17),
      },
      12
    ),
    exit: { tx: 35, ty: 4 },
    objects: [
      { type: 'laser', x: 21, y: 6, dir: 'down', length: 6 },
      { type: 'plate', x: 6, y: 11, w: 3, channel: 'a' },
      { type: 'platform', x: 25, y: 12, w: 5, to: [25, 5], period: 320, travel: 0.25, phase: 0.1875 },
      { type: 'gate', x: 33, y: 3, h: 3, channel: 'a' },
    ],
    entities: [{ type: 'box', x: 12, y: 11 }],
    prompts: [P('THE BEAM STOPS AT WHAT IT HITS', 18, 8, 'start', 600)],
  },

  // ------------------------------------------------------------------ 14 ---
  {
    id: 14,
    name: 'CHORUS',
    subtitle: 'three of them, one of you',
    palette: 4,
    maxEchoes: 3,
    par: 4,
    hint: 'ORDER OF OPERATIONS',
    map: room(48, 14, { 11: at(1) + 'p' }),
    exit: { tx: 46, ty: 11 },
    objects: [
      { type: 'plate', x: 5, y: 11, w: 2, channel: 'a' },
      { type: 'door', x: 12, y: 9, h: 3, channel: 'a' },
      { type: 'plate', x: 18, y: 11, w: 2, channel: 'b' },
      { type: 'gate', x: 24, y: 9, h: 3, echoes: 2 },
      { type: 'plate', x: 32, y: 11, w: 2, channel: 'c' },
      { type: 'door', x: 40, y: 9, h: 3, channel: 'c' },
    ],
    prompts: [P('THE GATE COUNTS YOUR PAST', 24, 7, 'start', 900)],
  },

  // ------------------------------------------------------------------ 15 ---
  {
    id: 15,
    name: 'ECHO//SHIFT',
    subtitle: 'your past is still playing',
    palette: 5,
    maxEchoes: 4,
    par: 2,
    hint: 'CORRUPT IT FOR THE GATE, THEN HOLD IT TOGETHER',
    map: room(
      48,
      16,
      {
        10: at(19) + full('=', 3),
        11: at(1) + 'p',
      },
      12
    ),
    exit: { tx: 45, ty: 11 },
    objects: [
      { type: 'plate', x: 6, y: 11, w: 2, channel: 'a' },
      { type: 'door', x: 12, y: 9, h: 3, channel: 'a' },
      { type: 'switch', x: 15, y: 11, channel: 'd' },
      { type: 'dampener', x: 4, y: 7, w: 6, h: 4, channel: 'd', radius: 6 },
      { type: 'laser', x: 21, y: 6, dir: 'down', length: 6 },
      { type: 'gate', x: 34, y: 9, h: 3, corrupt: 1, latch: true },
    ],
    entities: [{ type: 'box', x: 4, y: 11 }],
    prompts: [
      P('STEAL THE BOX IT EXPECTS', 10, 8, 'start', 900),
      P('THEN HOLD IT TOGETHER  [E]', 15, 10, 'start', 1500),
    ],
  },
];

export const LEVEL_COUNT = LEVELS.length;
export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}
