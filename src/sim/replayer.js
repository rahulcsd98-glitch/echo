// Replays a delta-encoded input stream. The cursor is driven by the echo's own
// temporal cursor, so a corrupted echo can freeze or fast-forward it.
export class Replayer {
  constructor(rows) {
    this.rows = rows;
    this.idx = 0;
    this.cum = 0;
    this.held = 0;
    this.prevHeld = 0;
    this.lastTick = -1;
  }

  reset() {
    this.idx = 0;
    this.cum = 0;
    this.held = 0;
    this.prevHeld = 0;
    this.lastTick = -1;
  }

  maskAt(tick) {
    while (this.idx < this.rows.length && this.cum + this.rows[this.idx][0] <= tick) {
      this.cum += this.rows[this.idx][0];
      this.held = this.rows[this.idx][1];
      this.idx++;
    }
    return this.held;
  }

  inputAt(tick) {
    if (tick === this.lastTick) {
      return { held: this.held & 0xff, pressed: 0 };
    }
    const mask = this.maskAt(tick);
    const held = mask & 0xff;
    const pressed = held & ~this.prevHeld;
    this.prevHeld = held;
    this.lastTick = tick;
    return { held, pressed };
  }
}
