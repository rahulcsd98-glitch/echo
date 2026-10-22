import {
  CORRUPT_SYNC,
  ECHO_FADE_TICKS,
  ECHO_HP,
  PLAYER_H,
  PLAYER_W,
  TRACE_INTERVAL,
  UNSTABLE_SYNC,
} from './constants.js';
import { Body, characterStep } from './entities.js';
import { applySample, spike, syncOf } from './divergence.js';
import { BTN } from './input.js';
import { clamp } from './math.js';
import { Rng } from './prng.js';
import { Replayer } from './replayer.js';

// ---------------------------------------------------------------------------
// Echo: a previous attempt, replayed tick for tick through the same
// character controller the player uses. It is a real participant in the room:
// it presses plates, shoves boxes, trips sensors - and it destabilises when the
// world stops matching what it remembers.
// ---------------------------------------------------------------------------

export class Echo extends Body {
  constructor(index, recording) {
    super(recording.spawn.x, recording.spawn.y, PLAYER_W, PLAYER_H);
    this.kind = 'echo';
    this.type = 'echo';
    this.index = index;
    this.id = `echo${index}`;
    this.recording = recording;
    this.replayer = new Replayer(recording.rows);
    this.ct = 0; // temporal cursor: how far into its own recording it is
    this.state = 'materialising';
    this.divergence = 0;
    this.sync = 1;
    this.alive = true;
    this.materialise = 0;
    this.fade = 0;
    this.looping = false;
    this.freeze = 0;
    this.skip = 0;
    this.glitched = false;
    this.exposed = false;
    this.stabilized = false;
    this.stallTicks = 0;
    this.pulseTick = 0;
    this.rng = new Rng(0x5eed + index * 7919 + (recording.seed | 0));
    this.interestMask = recording.interestMask;
    this.everCorrupted = false;
    this.hp = ECHO_HP;
    this.invuln = 0;
    this.hitFlash = 0;
  }

  get opacity() {
    return clamp(0.86 - this.index * 0.15, 0.24, 0.86);
  }

  get ageIndex() {
    return this.index;
  }

  update(world) {
    this.invuln = Math.max(0, this.invuln - 1);
    this.hitFlash = Math.max(0, this.hitFlash - 0.08);
    if (!this.alive) return;
    this.materialise = Math.min(1, this.materialise + 0.055);
    if (this.state === 'materialising' && this.materialise >= 1) this.state = 'active';

    const rec = this.recording;
    // recorded death: the echo re-lives it (and vanishes)
    if (rec.deathTick >= 0 && this.ct >= rec.deathTick) {
      world.pushEvent('ECHO_LOST', this, { source: 'replay' }, this.id);
      world.flash({ x: this.cx, y: this.cy, kind: 'echo_death' });
      world.addShake(0.45);
      world.glitch = Math.min(1.4, world.glitch + 0.4);
      this.alive = false;
      this.state = 'dead';
      this.deathTick = world.tick;
      this.divergence = 1;
      return;
    }

    const endTick = rec.truncated ? Math.min(rec.ticks, rec.maxTick) : rec.ticks;
    if (this.ct >= endTick) {
      if (this.wasCorrupted) {
        // corrupted echoes cannot let go: they loop their own recording
        this.replayer.reset();
        this.ct = 0;
        this.looping = true;
        world.flash({ x: this.cx, y: this.cy, kind: 'temporal_snap' });
      } else {
        this.state = 'done';
        this.fade += 1;
        if (this.fade > ECHO_FADE_TICKS) {
          this.alive = false;
          this.state = 'despawned';
          world.flash({ x: this.cx, y: this.cy, kind: 'echo_despawn' });
          world.removeEcho(this);
          return;
        }
      }
    }

    // advance the temporal cursor (glitchy when corrupted)
    let advance = 1;
    if (this.wasCorrupted) {
      if (this.freeze > 0) {
        this.freeze--;
        advance = 0;
        this.glitched = true;
      } else if (this.skip > 0) {
        this.skip--;
        advance = 3;
        this.glitched = true;
      } else if (this.rng.next() < 0.022) {
        if (this.rng.next() < 0.45) {
          this.freeze = 10 + this.rng.int(24);
          world.flash({ x: this.cx, y: this.cy, kind: 'glitch' });
        } else {
          this.skip = 6 + this.rng.int(18);
          world.flash({ x: this.cx, y: this.cy, kind: 'glitch' });
        }
      }
    } else {
      this.glitched = this.divergence > 0.35;
    }
    for (let i = 0; i < advance; i++) this.ct++;

    const input = this.replayer.inputAt(this.ct);
    if (this.freeze > 0 && this.freeze % 22 === 0) {
      // repeated action: it keeps hammering the same input
      input.pressed |= input.held & (BTN.JUMP | BTN.INTERACT | BTN.GRAB);
    }
    this.inputMask = input.held;
    characterStep(world, this, input, { sprint: true });

    // temporal pull on nearby machinery while corrupted
    if (this.wasCorrupted) {
      this.pulseTick++;
      if (this.pulseTick >= 70) {
        this.pulseTick = 0;
        for (const b of world.boxes) {
          if (!b.alive || b.carriedBy) continue;
          const d = Math.hypot(b.cx - this.cx, b.cy - this.cy);
          if (d < 70) b.vx += (b.cx > this.cx ? 1 : -1) * 0.35;
        }
        world.flash({ x: this.cx, y: this.cy, kind: 'temporal_pull' });
      }
    }
  }

  postUpdate(world) {
    if (!this.alive || this.state === 'done') return;
    if (world.tick % TRACE_INTERVAL === 0) applySample(this, world);

    const sync = syncOf(this);
    this.sync = sync;
    const corrupt = this.wasCorrupted ? sync < 0.62 : sync < CORRUPT_SYNC;
    this.wasCorrupted = corrupt;
    if (corrupt) {
      if (!this.everCorrupted) {
        this.everCorrupted = true;
        this.state = 'corrupted';
        world.pushEvent('ECHO_CORRUPT', this, { sync }, this.id);
        world.flash({ x: this.cx, y: this.cy, kind: 'echo_corrupt' });
        world.addShake(0.55);
        world.glitch = Math.min(1.6, world.glitch + 0.7);
      } else if (this.state !== 'corrupted') {
        this.state = 'corrupted';
      }
    } else if (sync < UNSTABLE_SYNC) {
      if (this.state !== 'unstable' && this.state !== 'materialising') {
        world.pushEvent('ECHO_UNSTABLE', this, { sync }, this.id);
      }
      this.state = 'unstable';
    } else if (this.state !== 'materialising' && this.state !== 'done') {
      this.state = 'active';
    }

    // a blocked path is divergence the instant it is felt
    if (((this.inputMask || 0) & (BTN.LEFT | BTN.RIGHT)) !== 0 && this.onGround && Math.abs(this.movedX) < 0.06) {
      this.stallTicks++;
      if (this.stallTicks === 45) {
        spike(this, 0.1);
        world.flash({ x: this.cx, y: this.cy, kind: 'glitch' });
      }
    } else if (this.stallTicks > 0) {
      this.stallTicks = Math.max(0, this.stallTicks - 2);
    }

    if (this.interactMissing) {
      spike(this, 0.16);
      this.interactMissing = false;
    }
    if (this.grabMissing) {
      // the past reached for something that is no longer there
      spike(this, 0.18);
      this.grabMissing = false;
      world.flash({ x: this.cx, y: this.cy, kind: 'glitch' });
    }
    this.stabilized = false;
  }
}
