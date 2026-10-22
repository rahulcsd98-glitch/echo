// Simulation constants. Everything the sim does runs on a fixed 60Hz tick.
export const TICK_RATE = 60;
export const DT = 1000 / TICK_RATE;

export const TILE = 24;

// --- Player body -----------------------------------------------------------
export const PLAYER_W = 14;
export const PLAYER_H = 22;
export const GRAVITY = 0.58;
export const MAX_FALL = 13.5;
export const RUN_ACCEL = 0.85;
export const RUN_SPEED = 3.2;
export const SPRINT_SPEED = 4.7;
export const GROUND_FRICTION = 0.72;
export const AIR_FRICTION = 0.94;
export const JUMP_VELOCITY = -8.1;
export const JUMP_CUT = 0.42;
export const COYOTE_TICKS = 6;
export const JUMP_BUFFER_TICKS = 7;
export const INTERACT_RANGE = 28;
export const PLAYER_HP = 2;
export const ECHO_HP = 3;
export const IFRAME_TICKS = 70;

export const BOX_SIZE = 22;
export const BOX_PUSH_SPEED = 1.15;
export const BOX_FRICTION = 0.68;
export const BOX_GRAVITY = 0.58;

// --- Timeline ---------------------------------------------------------------
export const TRACE_INTERVAL = 4; // ticks between divergence samples
export const MAX_ECHOES = 4;
export const ECHO_FADE_TICKS = 40;

// Divergence model
export const DIVERGENCE_GAIN = 0.055; // EMA factor per trace sample
export const DIVERGENCE_STATE_WEIGHT = 0.55;
export const DIVERGENCE_POS_WEIGHT = 0.45;
export const DIVERGENCE_SPIKE = 0.22; // invalid interaction / destroyed target
export const CORRUPT_SYNC = 0.5; // below this: CORRUPTED
export const UNSTABLE_SYNC = 0.78; // below this: destabilising

export const HUNTER_RANGE = 190;
export const HUNTER_SPEED = 1.5;
export const GUARD_VISION = 150;
export const GUARD_VERTICAL_VISION = 60;
export const GUARD_SPEED = 1.05;
export const GUARD_CHASE_SPEED = 2.05;
