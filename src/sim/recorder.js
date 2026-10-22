import { TRACE_INTERVAL } from './constants.js';

export const MAX_RECORD_TICKS = 60 * 150;

// ---------------------------------------------------------------------------
// Records one attempt:
//  - rows: delta-encoded held-input mask (drives the echo replay)
//  - events: meaningful gameplay events with metadata (debug + interest mask)
//  - trace: sparse samples of player position + world signature, used by the
//    upcoming attempt to notice when reality no longer matches expectation
// ---------------------------------------------------------------------------
export class EventRecorder {
  constructor(spawn, seed) {
    this.spawn = { x: spawn.x, y: spawn.y };
    this.seed = seed;
    this.rows = [[0, 0]];
    this.rowCum = 0;
    this.prevMask = 0;
    this.events = [];
    this.trace = [];
    this.counts = {};
    this.ticks = 0;
    this.truncated = false;
    this.completed = false;
    this.deathTick = -1;
    this.deathCause = '';
  }

  free() {
    this.rows.length = 0;
    this.events.length = 0;
    this.trace.length = 0;
  }

  recordTick(world, input) {
    if (this.ticks >= MAX_RECORD_TICKS) {
      this.truncated = true;
      return;
    }
    this.ticks++;
    const mask = input.held & 0xff;
    if (mask !== this.prevMask) {
      // rows are (delta, mask): delta counted in ticks from the previous row
      const dt = world.tick - this.rowCum;
      this.rows.push([dt, mask]);
      this.rowCum = world.tick;
      this.prevMask = mask;
    }
    if (world.tick % TRACE_INTERVAL === 0) {
      this.trace.push(
        Math.round(world.player.x),
        Math.round(world.player.y),
        world.objectStateMask(),
        world.boxHash()
      );
    }
    const evs = world.drainEvents();
    if (evs) {
      for (const e of evs) {
        this.events.push({ t: e.t, type: e.type, x: e.x, y: e.y, target: e.target, meta: e.meta });
        this.counts[e.type] = (this.counts[e.type] || 0) + 1;
        if (e.type === 'DEATH') {
          this.deathTick = e.t;
          this.deathCause = e.meta && e.meta.cause ? e.meta.cause : 'unknown';
        }
        if (e.type === 'LEVEL_COMPLETE') this.completed = true;
      }
    }
  }

  finalize(world) {
    return {
      id: 0,
      spawn: this.spawn,
      seed: this.seed,
      rows: this.rows,
      ticks: this.ticks,
      maxTick: Math.max(this.ticks, world.tick),
      events: this.events,
      counts: this.counts,
      trace: this.trace,
      traceLen: Math.floor(this.trace.length / 4),
      completed: this.completed || world.complete,
      truncated: this.truncated,
      deathTick: this.deathTick,
      deathCause: this.deathCause,
      interestMask: this.interestMask(world),
      boxInterested: (this.counts.PICKUP || 0) > 0 || (this.counts.DROP || 0) > 0 || (this.counts.PUSH || 0) > 0,
    };
  }

  // Objects the original attempt actually touched: only these participate in
  // divergence scoring, so cooperating with an echo does not destabilise it.
  interestMask(world) {
    let mask = 0;
    for (const e of this.events) {
      if (!e.target) continue;
      const obj = world.objects.find((o) => o.id === e.target);
      if (obj && obj.bitIndex !== undefined) mask |= 1 << obj.bitIndex;
    }
    for (const o of world.stateObjects) {
      if (o.type === 'exit' && o.bitIndex !== undefined) mask |= 1 << o.bitIndex;
    }
    return mask;
  }

  summary() {
    return {
      ticks: this.ticks,
      events: this.events.length,
      counts: this.counts,
      traceLen: Math.floor(this.trace.length / 4),
    };
  }
}
