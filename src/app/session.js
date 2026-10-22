import { buildLevel } from '../sim/level.js';
import { World } from '../sim/world.js';
import { EventRecorder } from '../sim/recorder.js';
import { EchoManager } from '../sim/echoManager.js';
import { getLevel } from '../levels/index.js';

// ---------------------------------------------------------------------------
// Session: owns the room, the attempt lifecycle and the timeline.
// No DOM, no canvas - the game shell and the headless test harness both drive
// this same object, so anything proven in tests is what the player plays.
// ---------------------------------------------------------------------------

export const STATE = {
  PLAYING: 'playing',
  DEAD: 'dead',
  COMPLETE: 'complete',
};

export const DEATH_HOLD_TICKS = 96;

export class Session {
  constructor(levelId, opts = {}) {
    this.levelId = levelId;
    this.levelDef = getLevel(levelId);
    this.level = buildLevel(this.levelDef);
    this.manager = new EchoManager(this.level);
    this.seedBase = opts.seed ?? 20481;
    this.attempts = 0;
    this.deaths = 0;
    this.restarts = 0;
    this.everCompleted = false;
    this.totalTicks = 0;
    this.startAttempt();
  }

  get maxEchoes() {
    return this.level.maxEchoes;
  }

  startAttempt() {
    this.attempts++;
    this.world = new World(this.level, this.seedBase + this.attempts * 977);
    this.manager.spawnInto(this.world);
    this.recorder = new EventRecorder(this.level.spawn, this.world.seed);
    this.state = STATE.PLAYING;
    this.deadTicks = 0;
    this.attemptStart = this.world.tick;
    this.droppedEcho = false;
    this.levelEndedAt = -1;
  }

  /** Advance one simulation tick with the player's input for that tick. */
  step(input) {
    if (this.state === STATE.COMPLETE) return;
    this.world.step(input);
    this.recorder.recordTick(this.world, input);
    this.totalTicks++;
    if (this.world.complete) {
      this.state = STATE.COMPLETE;
      this.everCompleted = true;
      this.completion = {
        attempts: this.attempts,
        ticks: this.totalTicks,
        deaths: this.deaths,
        echoes: this.manager.count,
      };
      this.levelEndedAt = this.world.tick;
    } else if (this.world.playerDead) {
      if (this.state !== STATE.DEAD) {
        this.state = STATE.DEAD;
        this.deaths++;
        this.deadTicks = 0;
      }
    }
    if (this.state === STATE.DEAD) this.deadTicks++;
  }

  /** Commit the attempt as an echo and rebuild the room. */
  restart(cause = 'manual') {
    if (this.state === STATE.COMPLETE) return null;
    const rec = this.recorder.finalize(this.world);
    rec.cause = cause;
    rec.attempt = this.attempts;
    if (rec.ticks > 4 || rec.events.length > 0) {
      if (this.manager.recordings.length >= this.level.maxEchoes) this.droppedEcho = true;
      this.manager.commit(rec);
    }
    this.restarts++;
    this.startAttempt();
    return rec;
  }

  get echoes() {
    return this.world ? this.world.echoes : [];
  }

  get syncAverage() {
    const e = this.echoes;
    if (!e.length) return 1;
    let s = 0;
    for (const x of e) s += Math.max(0, 1 - x.divergence);
    return s / e.length;
  }

  /** Snapshot used by the HUD timeline visualiser. */
  timeline() {
    const out = [];
    const recs = this.manager.activeRecordings();
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const echo = this.echoes.find((e) => e.label === i + 1);
      out.push({
        label: i + 1,
        id: rec.id,
        ticks: rec.maxTick,
        events: rec.events.length,
        endedInDeath: rec.deathTick >= 0,
        alive: !!echo,
        sync: echo ? Math.max(0, 1 - echo.divergence) : null,
        state: echo ? echo.state : 'despawned',
        progress: echo ? Math.min(1, echo.ct / Math.max(1, rec.ticks)) : 1,
      });
    }
    return out;
  }

  /** Deterministic world fingerprint (used by tests + debug overlay). */
  fingerprint() {
    const w = this.world;
    let h = 2166136261;
    const push = (v) => {
      h ^= (v | 0) & 0xffff;
      h = Math.imul(h, 16777619);
    };
    push(Math.round(w.player.x));
    push(Math.round(w.player.y));
    push(w.objectStateMask());
    push(w.boxHash());
    for (const e of w.echoes) {
      push(Math.round(e.x));
      push(Math.round(e.y));
      push(Math.round(e.divergence * 1000));
      push(e.alive ? 1 : 0);
    }
    for (const en of w.enemies) {
      push(Math.round(en.x));
      push(Math.round(en.y));
      push(en.alert * 100);
      push(en.stunned || 0);
    }
    return h >>> 0;
  }

  stats() {
    const counts = this.recorder.counts;
    return {
      level: this.levelDef.id,
      name: this.levelDef.name,
      attempts: this.attempts,
      echoes: this.echoes.length,
      recorded: this.manager.count,
      tick: this.world.tick,
      events: this.recorder.events.length,
      counts,
      sync: this.syncAverage,
    };
  }
}
