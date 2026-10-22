import {
  GUARD_CHASE_SPEED,
  GUARD_SPEED,
  GUARD_VERTICAL_VISION,
  GUARD_VISION,
  HUNTER_RANGE,
  HUNTER_SPEED,
  TILE,
} from './constants.js';
import { Body, stepX, stepY } from './entities.js';
import { clamp } from './math.js';

// ---------------------------------------------------------------------------
// Enemies. All of them are tick-driven state machines: no wall-clock, no
// Math.random, so a replay and the live run behave identically.
// ---------------------------------------------------------------------------

const GROUND_PROBE = 4;

function groundAhead(world, body, dir) {
  const px = body.cx + dir * (body.w / 2 + GROUND_PROBE);
  const py = body.y + body.h + 2;
  return world.grid.solidAtPoint(px, py);
}

function wallAhead(world, body, dir, height = 1) {
  const px = body.cx + dir * (body.w / 2 + 3);
  for (let i = 0; i < height; i++) {
    if (world.grid.solidAtPoint(px, body.y + body.h - 4 - i * TILE)) return true;
  }
  return false;
}

export class Guard extends Body {
  constructor(def, world) {
    const x = def.x * TILE + 3;
    const y = def.y * TILE + (TILE - 26);
    super(x, y, 16, 26);
    this.kind = 'guard';
    this.type = 'guard';
    this.state = 'PATROL';
    this.alert = 0;
    this.facing = def.facing === 'left' ? -1 : 1;
    this.patrolFrom = (def.from ?? def.x) * TILE + 8;
    this.patrolTo = (def.to ?? def.x + 4) * TILE + 16;
    this.speed = (def.speed ?? 1) * GUARD_SPEED;
    this.vision = def.vision ?? GUARD_VISION;
    this.target = null;
    this.lastKnown = null;
    this.timer = 0;
    this.lookTimer = 0;
    this.stepTick = 0;
    this.stunned = 0;
    this.spawnX = x;
  }

  get label() {
    return this.state;
  }

  canSee(world, ent) {
    if (!ent.alive) return false;
    const dx = ent.cx - this.cx;
    const dy = ent.cy - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > this.vision) return false;
    if (Math.abs(dy) > GUARD_VERTICAL_VISION) return false;
    const inFront = Math.sign(dx) === this.facing || Math.abs(dx) < 26;
    if (!inFront) return false;
    return world.lineOfSight(this.cx, this.cy, ent.cx, ent.cy);
  }

  pickTarget(world) {
    let best = null;
    let bestD = Infinity;
    for (const ent of world.characters) {
      if (!ent.alive) continue;
      if (!this.canSee(world, ent)) continue;
      const d = Math.hypot(ent.cx - this.cx, ent.cy - this.cy);
      const bias = ent.kind === 'echo' ? 0 : 12; // echoes are tempting targets
      if (d + bias < bestD) {
        bestD = d + bias;
        best = ent;
      }
    }
    return best;
  }

  update(world) {
    if (!this.alive) return;
    if (this.stunned > 0) {
      this.stunned--;
      this.vx *= 0.85;
      this.vy = Math.min(this.vy + 0.58, 13);
      stepX(world, this, this.vx, 0);
      stepY(world, this, this.vy, 0);
      this.onGround = this.blockedDown;
      return;
    }
    this.timer++;
    const seen = this.pickTarget(world);
    const prevState = this.state;

    switch (this.state) {
      case 'IDLE':
      case 'PATROL': {
        this.vx = this.facing * this.speed;
        if (wallAhead(world, this, this.facing) || !groundAhead(world, this, this.facing)) {
          this.facing *= -1;
          if (this.state === 'IDLE') this.timer = 0;
        }
        if (this.cx < this.patrolFrom) this.facing = 1;
        if (this.cx > this.patrolTo) this.facing = -1;
        if (this.state === 'PATROL' && this.timer % 260 === 0) {
          this.state = 'IDLE';
          this.timer = 0;
        }
        if (this.state === 'IDLE' && this.timer > 70) {
          this.state = 'PATROL';
          this.timer = 0;
        }
        break;
      }
      case 'SUSPICIOUS': {
        const lk = this.lastKnown;
        if (!lk) {
          this.state = 'RETURN';
          break;
        }
        const dx = lk.x - this.cx;
        this.facing = Math.sign(dx) || this.facing;
        if (Math.abs(dx) > 10) {
          this.vx = this.facing * this.speed * 0.9;
          if (wallAhead(world, this, this.facing)) this.vx = 0;
        } else {
          this.vx *= 0.8;
          this.lookTimer++;
          if (this.lookTimer % 40 === 0) this.facing *= -1;
        }
        this.timer++;
        if (this.timer > 220) {
          this.state = 'SEARCH';
          this.timer = 0;
        }
        break;
      }
      case 'CHASE': {
        const t = this.target;
        if (!t || !t.alive) {
          this.state = 'SEARCH';
          this.timer = 0;
          break;
        }
        this.lastKnown = { x: t.cx, y: t.cy };
        if (!this.canSee(world, t)) this.lostTicks = (this.lostTicks || 0) + 1;
        else this.lostTicks = 0;
        if (this.lostTicks > 110) {
          this.target = null;
          this.state = 'SEARCH';
          this.timer = 0;
          this.alert = 0.3;
          break;
        }
        const dx = t.cx - this.cx;
        const fast = t.kind === 'echo' ? 1 : 1.35;
        this.facing = Math.sign(dx) || this.facing;
        this.vx = this.facing * GUARD_CHASE_SPEED * fast;
        if (wallAhead(world, this, this.facing, 2) && this.onGround) {
          // hop over low cover / small ledges
          this.vy = -6.6;
          this.onGround = false;
        }
        this.alert = clamp(this.alert + (this.canSee(world, t) ? 0.03 : -0.02), 0, 1);
        if (this.alert <= 0.05) {
          this.state = 'SEARCH';
          this.timer = 0;
        }
        break;
      }
      case 'SEARCH': {
        const lk = this.lastKnown || { x: this.cx, y: this.cy };
        const dx = lk.x - this.cx;
        this.timer++;
        if (Math.abs(dx) > 16 && this.timer < 200) {
          this.facing = Math.sign(dx);
          this.vx = this.facing * this.speed * 1.1;
          if (wallAhead(world, this, this.facing)) this.vx = 0;
        } else if (this.timer < 320) {
          this.vx *= 0.85;
          if (this.timer % 45 === 0) this.facing *= -1;
        } else {
          this.state = 'RETURN';
          this.timer = 0;
        }
        break;
      }
      case 'RETURN': {
        const targetX = clamp(this.spawnX, this.patrolFrom, this.patrolTo);
        const dx = targetX - this.cx;
        if (Math.abs(dx) > 12) {
          this.facing = Math.sign(dx);
          this.vx = this.facing * this.speed;
        } else {
          this.vx *= 0.7;
          this.state = 'PATROL';
          this.timer = 0;
        }
        break;
      }
      default:
        this.state = 'PATROL';
    }

    if (seen) {
      // a guard that has committed to a target keeps chasing it: that is what
      // makes luring it with an echo reliable
      if (this.state !== 'CHASE') this.target = seen;
      this.alert = clamp(this.alert + 0.045, 0, 1);
      if (this.alert >= 0.55) {
        if (prevState !== 'CHASE') {
          world.pushEvent('ALERT', this, { target: seen.id, kind: 'guard' });
          world.emitNoise(this.cx, this.cy, 150, 'alert');
        }
        this.state = 'CHASE';
        this.target = seen;
        this.lastKnown = { x: seen.cx, y: seen.cy };
        this.timer = 0;
      } else if (this.state === 'PATROL' || this.state === 'IDLE') {
        this.state = 'SUSPICIOUS';
        this.lastKnown = { x: seen.cx, y: seen.cy };
        this.timer = 0;
      }
    } else if (this.state !== 'CHASE') {
      this.alert = clamp(this.alert - 0.012, 0, 1);
    }

    // hearing
    for (const n of world.lastNoises) {
      const d = Math.hypot(n.x - this.cx, n.y - this.cy);
      if (d < n.r) {
        this.lastKnown = { x: n.x, y: n.y };
        if (this.state === 'PATROL' || this.state === 'IDLE' || this.state === 'RETURN') {
          this.state = 'SUSPICIOUS';
          this.timer = 0;
          this.alert = clamp(this.alert + 0.12, 0, 1);
        }
      }
    }

    this.vy = Math.min(this.vy + 0.58, 13);
    stepX(world, this, this.vx, 0);
    stepY(world, this, this.vy, 0);
    this.onGround = this.blockedDown;
    if (this.blockedDown) this.vy = 0;
    if (this.blockedDown && Math.abs(this.vx) > 0.5) {
      this.stepTick++;
      if (this.stepTick % 26 === 0) world.emitNoise(this.cx, this.y + this.h, 30, 'guard_step');
    }
    this.pushTrail();
  }
}

export class TemporalHunter extends Body {
  constructor(def, world) {
    super(def.x * TILE + 2, def.y * TILE + 2, 20, 20);
    this.kind = 'hunter';
    this.type = 'hunter';
    this.vx = 0;
    this.vy = 0;
    this.speed = HUNTER_SPEED * (def.speed ?? 1);
    this.target = null;
    this.stun = 0;
    this.angry = 0;
    this.hoverSeed = Math.floor((def.x + def.y) * 7) % 100;
    this.trail = [];
  }

  findTarget(world) {
    let best = null;
    let bestScore = Infinity;
    for (const e of world.echoes) {
      if (!e.alive) continue;
      const d = Math.hypot(e.cx - this.cx, e.cy - this.cy);
      let score = d;
      if (e.state === 'corrupted') score *= 0.35; // corrupted echoes scream
      else if (e.sync < 0.74) score *= 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  update(world) {
    if (!this.alive) return;
    if (this.stun > 0) {
      this.stun--;
      this.vx *= 0.86;
      this.vy *= 0.86;
      this.pushTrail();
      return;
    }
    const t = this.findTarget(world);
    this.target = t;
    this.angry = t && (t.state === 'corrupted' || t.sync < 0.5) ? 1 : 0;
    let ax = 0;
    let ay = 0;
    if (t) {
      const dx = t.cx - this.cx;
      const dy = t.cy - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      // drift preference: horizontal first, vertical second
      ax = dx / d;
      ay = dy / d;
      if (d < 12) {
        world.consumeEcho(t, this);
      }
    } else {
      const bob = Math.sin((world.tick + this.hoverSeed) * 0.02);
      ax = 0;
      ay = bob * 0.4;
    }
    const wantX = ax * this.speed;
    const wantY = ay * this.speed * 0.85;
    this.vx += (wantX - this.vx) * 0.06;
    this.vy += (wantY - this.vy) * 0.06;

    const beforeX = this.x;
    stepX(world, this, this.vx, 0);
    if (Math.abs(this.x - beforeX) < Math.abs(this.vx) - 0.01) {
      // slide along the obstruction
      this.vy = Math.sign(ay || 1) * this.speed * 0.9;
    }
    const beforeY = this.y;
    stepY(world, this, this.vy, 0);
    if (Math.abs(this.y - beforeY) < Math.abs(this.vy) - 0.01) {
      this.vx = Math.sign(ax || -1) * this.speed * 0.9;
    }
    if (this.stun > 0) this.vx = this.vy = 0;
    this.pushTrail();
  }
}

export class Sentinel {
  constructor(def) {
    this.type = 'sentinel';
    this.kind = 'sentinel';
    this.id = def.id;
    this.tx = def.x;
    this.ty = def.y;
    this.x = def.x * TILE + TILE / 2;
    this.y = def.y * TILE + TILE / 2;
    this.baseAngle = def.angle ?? (def.dir === 'left' ? Math.PI : def.dir === 'down' ? Math.PI / 2 : 0);
    this.sweep = def.sweep ?? 0.55;
    this.period = def.period ?? 300;
    this.range = (def.range ?? 9) * TILE;
    this.alert = 0;
    this.fire = 0;
    this.cooldown = 0;
    this.angle = this.baseAngle;
    this.beamLen = 0;
    this.jitter = 0;
    this.locked = null;
    this.noise = 0;
  }

  // Sentinels hunt temporal signatures first: an echo is a louder anomaly
  // than a person, which is what makes them distractible.
  findTarget(world) {
    let echo = null;
    let body = null;
    for (const c of world.characters) {
      if (!c.alive) continue;
      const d = Math.hypot(c.cx - this.x, c.cy - this.y);
      if (d > this.range * 1.05) continue;
      if (!world.lineOfSight(this.x, this.y, c.cx, c.cy)) continue;
      if (c.kind === 'echo') {
        if (!echo) echo = c;
      } else if (!body) body = c;
    }
    return echo || body;
  }

  update(world) {
    const phase = (world.tick / this.period) % 1;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const eased = tri * tri * (3 - 2 * tri);
    const sweepAngle = this.baseAngle + (eased - 0.5) * 2 * this.sweep;
    const target = this.findTarget(world);
    this.noise = world.temporalNoiseAt ? world.temporalNoiseAt(this.x, this.y) : 0;
    this.jitter = this.noise;

    if (this.fire > 0) {
      this.fire--;
      if (this.fire === 0) this.cooldown = 96;
    } else if (this.cooldown > 0) {
      this.cooldown--;
      this.alert = Math.max(0, this.alert - 0.02);
    } else {
      const seen = !!target;
      this.alert = clamp(this.alert + (seen ? 0.028 : -0.014) + this.noise * 0.05, 0, 1);
      if (this.alert >= 1) {
        this.fire = 50;
        this.alert = 0.98;
        this.locked = target;
        world.pushEvent('SENTINEL_FIRE', this, { locked: target ? target.id : null }, this.id);
        world.emitNoise(this.x, this.y, 170, 'sentinel');
        world.addShake(0.25);
      }
    }

    // while firing it tracks whatever it locked onto, otherwise it sweeps
    let angle = sweepAngle;
    const lock = this.fire > 0 ? this.locked : null;
    if (lock && lock.alive) {
      angle = Math.atan2(lock.cy - this.y, lock.cx - this.x);
      this.tracking = true;
    } else {
      this.tracking = false;
    }
    if (this.fire === 0) this.locked = null;
    this.angle = angle + (this.noise - 0.5) * 0.05;
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);

    this.beamLen = 0;
    this.beamDir = { x: dx, y: dy };
    if (this.fire > 0) {
      let len = this.range;
      const hitTile = world.grid.raycast(this.x, this.y, dx, dy, len, (tx, ty) => world.grid.solidTile(tx, ty), 3);
      if (hitTile >= 0) len = hitTile;
      const hitObj = world.raycastObjects(this.x, this.y, dx, dy, len);
      if (hitObj.dist >= 0 && hitObj.dist < len) len = hitObj.dist;
      const hitChar = world.raycastCharacters(this.x, this.y, dx, dy, len);
      if (hitChar.dist >= 0 && hitChar.dist < len) {
        len = hitChar.dist;
        this.blockedBy = hitChar.char.id;
      } else {
        this.blockedBy = null;
      }
      this.beamLen = len;
      world.hazardSegments.push({
        x1: this.x,
        y1: this.y,
        x2: this.x + dx * len,
        y2: this.y + dy * len,
        kind: 'beam',
        source: this.id,
      });
    }
  }
}

export function makeEnemy(def, world) {
  switch (def.type) {
    case 'guard':
      return new Guard(def, world);
    case 'hunter':
      return new TemporalHunter(def, world);
    case 'sentinel':
      return new Sentinel(def);
    default:
      return null;
  }
}
