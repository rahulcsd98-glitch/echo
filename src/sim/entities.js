import {
  AIR_FRICTION,
  IFRAME_TICKS,
  PLAYER_HP,
  BOX_FRICTION,
  BOX_GRAVITY,
  BOX_SIZE,
  COYOTE_TICKS,
  GRAVITY,
  GROUND_FRICTION,
  INTERACT_RANGE,
  JUMP_BUFFER_TICKS,
  JUMP_CUT,
  JUMP_VELOCITY,
  MAX_FALL,
  PLAYER_H,
  PLAYER_W,
  RUN_ACCEL,
  RUN_SPEED,
  SPRINT_SPEED,
  TILE,
} from './constants.js';
import { BTN } from './input.js';
import { TILE_ONEWAY } from './tiles.js';

// ---------------------------------------------------------------------------
// Bodies & movement.
// Movement is resolved in 1px sub-steps so boxes can be shoved predictably and
// the simulation stays deterministic for every echo replaying at once.
// ---------------------------------------------------------------------------

function overlapsRect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function stepX(world, body, dx, depth) {
  const dir = Math.sign(dx);
  if (dir === 0) return 0;
  let remaining = Math.abs(dx);
  let moved = 0;
  let boxBump = null;
  while (remaining > 1e-6) {
    const d = Math.min(1, remaining);
    body.x += dir * d;
    let ok = true;
    if (world.grid.overlapsSolid(body.x, body.y, body.w, body.h)) {
      ok = false;
    } else {
      const other = world.solidOverlap(body);
      if (other) {
        if (other.kind === 'box' && depth > 0 && !other.carriedBy && !body.carrying) {
          const m = stepX(world, other, dir * d, depth - 1);
          if (Math.abs(m) < d - 1e-6) ok = false;
          else {
            other.vx = 0;
            other.pushedTick = world.tick;
            boxBump = other;
          }
        } else {
          ok = false;
        }
      }
    }
    if (!ok) {
      body.x -= dir * d;
      break;
    }
    moved += d;
    remaining -= d;
  }
  if (boxBump) body.pushing = true;
  body.movedX = moved * dir;
  return moved * dir;
}

function stepY(world, body, dy, depth) {
  const dir = Math.sign(dy);
  body.landed = false;
  body.blockedDown = false;
  body.blockedUp = false;
  if (dir === 0) return 0;
  let remaining = Math.abs(dy);
  let moved = 0;
  let landed = false;
  while (remaining > 1e-6) {
    const d = Math.min(1, remaining);
    const prevBottom = body.y + body.h;
    body.y += dir * d;
    let ok = true;
    if (dir < 0) {
      // one-way platforms are ignored when moving up
      if (world.grid.overlapsSolid(body.x, body.y, body.w, body.h)) ok = false;
    } else {
      if (world.grid.overlapsSolid(body.x, body.y, body.w, body.h)) ok = false;
      else if (body.oneWay) {
        const rowTop = Math.floor((body.y + body.h - 0.001) / TILE) * TILE;
        if (prevBottom <= rowTop + 0.001) {
          const tx0 = Math.floor(body.x / TILE);
          const tx1 = Math.floor((body.x + body.w - 0.001) / TILE);
          const ty = Math.floor(rowTop / TILE);
          for (let tx = tx0; tx <= tx1; tx++) {
            if (world.grid.at(tx, ty) === TILE_ONEWAY) {
              body.y = rowTop - body.h;
              body.landed = true;
              ok = false;
              break;
            }
          }
        }
      }
    }
    if (ok && world.solidOverlap(body)) ok = false;
    if (!ok) {
      body.y -= dir * d;
      if (dir > 0) {
        body.blockedDown = true;
        if (!landed) landed = true;
      } else body.blockedUp = true;
      break;
    }
    moved += d;
    remaining -= d;
  }
  body.movedY = moved * dir;
  return moved * dir;
}

// ---------------------------------------------------------------------------

class Body {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.blockedDown = false;
    this.blockedDownPrev = false;
    this.landed = false;
    this.oneWay = true;
    this.alive = true;
    this.pushing = false;
    this.trail = [];
    this.trailTick = 0;
  }

  get cx() {
    return this.x + this.w / 2;
  }
  get cy() {
    return this.y + this.h / 2;
  }

  pushTrail() {
    if (++this.trailTick % 2 !== 0) return;
    this.trail.push({ x: this.x, y: this.y, f: this.facing, g: this.onGround ? 1 : 0 });
    if (this.trail.length > 22) this.trail.shift();
  }
}

export class Box extends Body {
  constructor(x, y) {
    super(x, y, BOX_SIZE, BOX_SIZE);
    this.kind = 'box';
    this.carriedBy = null;
    this.grounded = false;
    this.restTicks = 0;
  }

  update(world) {
    if (this.carriedBy) {
      const c = this.carriedBy;
      this.x = c.x + (c.facing > 0 ? 2 : -2);
      this.y = c.y - this.h - 1;
      this.vx = 0;
      this.vy = 0;
      if (!c.alive) world.dropBox(this, c);
      return;
    }
    this.vy = Math.min(this.vy + BOX_GRAVITY, MAX_FALL);
    this.vx *= this.onGround ? BOX_FRICTION : 0.98;
    if (Math.abs(this.vx) < 0.04) this.vx = 0;
    const prevBottom = this.y + this.h;
    stepX(world, this, this.vx, 0);
    stepY(world, this, this.vy, 0);
    const wasAir = !this.grounded;
    this.grounded = this.blockedDown;
    this.onGround = this.blockedDown;
    if (this.blockedDown) {
      if (this.vy > 5.5 && wasAir) world.emitNoise(this.cx, this.cy, 90, 'box_impact');
      this.vy = 0;
    }
    if (this.blockedDown && Math.abs(this.vx) < 0.2) this.restTicks++;
    else this.restTicks = 0;
    if (this.y > world.grid.pxHeight + 200) this.alive = false;
    void prevBottom;
  }
}

// ---------------------------------------------------------------------------

export function characterStep(world, b, input, opts = {}) {
  const held = input.held;
  const pressed = input.pressed;
  const dir = ((held & BTN.RIGHT) ? 1 : 0) - ((held & BTN.LEFT) ? 1 : 0);
  const sprint = (held & BTN.SPRINT) !== 0 && opts.sprint !== false;
  const maxSpeed = sprint ? SPRINT_SPEED : RUN_SPEED;

  b.pushing = false;
  b.sprinting = sprint && dir !== 0;

  if (dir !== 0) {
    b.vx += dir * RUN_ACCEL;
    if (dir > 0 ? b.vx > maxSpeed : b.vx < -maxSpeed) b.vx = dir * maxSpeed;
    b.facing = dir;
  } else {
    b.vx *= b.onGround ? GROUND_FRICTION : AIR_FRICTION;
    if (Math.abs(b.vx) < 0.06) b.vx = 0;
  }

  if (b.coyote === undefined) b.coyote = 0;
  if (b.jumpBuf === undefined) b.jumpBuf = 0;
  if (b.onGround) b.coyote = COYOTE_TICKS;
  else if (b.coyote > 0) b.coyote--;

  if (pressed & BTN.JUMP) b.jumpBuf = JUMP_BUFFER_TICKS;
  else if (b.jumpBuf > 0) b.jumpBuf--;

  if (b.jumpBuf > 0 && b.coyote > 0 && !b.carriedBy) {
    b.vy = JUMP_VELOCITY;
    b.jumpBuf = 0;
    b.coyote = 0;
    b.onGround = false;
    b.blockedDown = false;
    b.jumpHeld = true;
    world.pushEvent('JUMP', b);
    world.emitNoise(b.cx, b.cy, 46, 'jump');
  }
  if ((held & BTN.JUMP) === 0 && b.vy < 0 && b.jumpHeld) {
    b.vy *= JUMP_CUT;
    b.jumpHeld = false;
  }
  if (b.vy >= 0) b.jumpHeld = false;

  b.vy = Math.min(b.vy + GRAVITY, MAX_FALL);

  const prevOnGround = b.onGround;
  const prevVy = b.vy;
  stepX(world, b, b.vx, 2);
  stepY(world, b, b.vy, 2);
  b.onGround = b.blockedDown;
  if (b.blockedDown) {
    if (!prevOnGround && prevVy > 6.5) {
      world.emitNoise(b.cx, b.cy, sprint ? 120 : 96, 'land');
      world.pushEvent('LAND', b, { speed: Math.round(prevVy * 10) / 10 });
    }
    b.vy = 0;
  }
  if (b.blockedUp && b.vy < 0) b.vy = 0.4;

  b.interacting = false;
  b.holdInteract = (held & BTN.INTERACT) !== 0;
  if (pressed & BTN.INTERACT) {
    b.interacting = true;
    b.interactMissing = world.tryInteract(b) === null;
  }
  if (pressed & BTN.GRAB) b.grabMissing = world.tryGrab(b) === false;

  if (b.blockedDown && !b.onGround) b.onGround = true;

  b.pushTrail();
}

export class Player extends Body {
  constructor(x, y) {
    super(x, y, PLAYER_W, PLAYER_H);
    this.kind = 'player';
    this.state = 'idle';
    this.animTick = 0;
    this.carrying = null;
    this.deathTick = -1;
    this.deathKind = '';
    this.hp = PLAYER_HP;
    this.invuln = 0;
    this.hitFlash = 0;
  }

  update(world, input) {
    this.invuln = Math.max(0, this.invuln - 1);
    this.hitFlash = Math.max(0, this.hitFlash - 0.08);
    if (!this.alive) {
      this.deathTick++;
      this.state = 'dead';
      this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
      stepY(world, this, this.vy, 0);
      return;
    }
    characterStep(world, this, input, {});
    this.animTick++;
    if (!this.onGround) this.state = 'air';
    else if (this.pushing) this.state = 'push';
    else if (this.sprinting) this.state = 'run';
    else if (Math.abs(this.vx) > 0.4) this.state = 'walk';
    else if (this.interacting) this.state = 'interact';
    else this.state = 'idle';
  }
}

export { Body, stepX, stepY, overlapsRect };
