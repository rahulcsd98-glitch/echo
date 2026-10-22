// Input is a bitmask so it can be stored compactly inside recordings.
export const BTN = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  JUMP: 16,
  SPRINT: 32,
  INTERACT: 64,
  GRAB: 128,
};

export function makeInput() {
  return { held: 0, pressed: 0 };
}

export function packInput(input) {
  return (input.held & 0xff) | ((input.pressed & 0xff) << 8);
}

export function hasHeld(mask, btn) {
  return (mask & btn) !== 0;
}
export function hasPressed(mask, btn) {
  return (mask & (btn << 8)) !== 0;
}
