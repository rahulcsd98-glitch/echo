import {
  DIVERGENCE_SPIKE,
  INTERACT_RANGE,
  TILE,
} from './constants.js';
import { clamp, lerp } from './math.js';
import { overlapsRect } from './entities.js';

// ---------------------------------------------------------------------------
// World objects. Each one owns its own state machine and only talks to the
// world through channels: triggers write signals, consumers read them.
// ---------------------------------------------------------------------------

const EASE_STEP = 0.09;

export function isStateful(o) {
  return (
    o.type === 'plate' ||
    o.type === 'button' ||
    o.type === 'switch' ||
    o.type === 'relay' ||
    o.type === 'door' ||
    o.type === 'gate' ||
    o.type === 'laser' ||
    o.type === 'core' ||
    o.type === 'dampener'
  );
}

export function objectState(o) {
  switch (o.type) {
    case 'plate':
      return o.press > 0.4;
    case 'button':
      return o.power > 0;
    case 'switch':
    case 'relay':
      return o.on === true;
    case 'door':
    case 'gate':
      return o.open > 0.5;
    case 'laser':
      return o.firing === true;
    case 'dampener':
      return o.field === true;
    case 'core':
      return o.dead === true;
    default:
      return false;
  }
}

// --- Triggers --------------------------------------------------------------

export class Plate {
  constructor(o) {
    this.o = o;
    o.press = 0;
    o.pressed = false;
    o.occupants = 0;
  }
  update(world) {
    const o = this.o;
    let count = 0;
    const bodies = world.pressBodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.alive && b.kind !== 'box') continue;
      if (overlapsRect(b, { x: o.x - 1, y: o.y - 10, w: o.w + 2, h: o.h + 12 })) count++;
    }
    o.occupants = count;
    const pressed = count > 0;
    if (pressed !== o.pressed) {
      if (pressed) world.pushEvent('PLATE_DOWN', { cx: o.x + o.w / 2, cy: o.y + o.h / 2 }, { target: o.id }, o.id);
      else world.pushEvent('PLATE_UP', { cx: o.x + o.w / 2, cy: o.y + o.h / 2 }, { target: o.id }, o.id);
    }
    o.pressed = pressed;
    o.press = clamp(o.press + (pressed ? EASE_STEP : -EASE_STEP * 1.6), 0, 1);
    if (pressed) world.addSignal(o.channel);
  }
}

export class Button {
  constructor(o) {
    this.o = o;
    o.power = 0;
    o.depress = 0;
    o.mode = o.mode || 'timed';
    o.duration = o.duration || 150;
    o.holder = null;
  }
  onInteract(world, actor) {
    const o = this.o;
    if (o.mode === 'hold') {
      o.holder = actor.id;
    } else {
      o.power = o.duration;
    }
    world.pushEvent('BUTTON_PRESS', actor, { target: o.id }, o.id);
    world.emitNoise(o.x + o.w / 2, o.y + o.h / 2, 120, 'button');
  }
  update(world) {
    const o = this.o;
    let active = false;
    if (o.mode === 'hold') {
      if (o.holder) {
        const actor = world.bodyById(o.holder);
        if (actor && actor.alive && actor.interacting && world.inRange(actor, o, INTERACT_RANGE)) {
          active = true;
        } else if (actor && actor.alive) {
          // still held if the actor keeps the interact key down (echoes replay it)
          active = actor.holdInteract === true && world.inRange(actor, o, INTERACT_RANGE);
          if (!active) o.holder = null;
        } else {
          o.holder = null;
        }
      }
    } else if (o.power > 0) {
      o.power--;
      active = true;
    }
    o.depress = clamp(o.depress + (active ? 0.22 : -0.18), 0, 1);
    if (active) world.addSignal(o.channel);
  }
}

export class Switch {
  constructor(o) {
    this.o = o;
    o.on = o.start === true;
    o.lever = o.on ? 1 : 0;
  }
  onInteract(world, actor) {
    const o = this.o;
    o.on = !o.on;
    world.pushEvent('SWITCH', actor, { target: o.id, on: o.on }, o.id);
    world.emitNoise(o.x + o.w / 2, o.y + o.h / 2, 90, 'switch');
  }
  update(world) {
    const o = this.o;
    o.lever = clamp(o.lever + (o.on ? 0.16 : -0.16), 0, 1);
    if (o.on) world.addSignal(o.channel);
  }
}

export class Relay {
  constructor(o) {
    this.o = o;
    o.on = o.start === true;
    o.blink = 0;
    o.div = o.div || 1;
    o.edges = 0;
  }
  update(world) {
    const o = this.o;
    const input = !!world.signals[o.input];
    const rising = input && !o.lastInput;
    o.lastInput = input;
    if (rising) {
      o.edges++;
      if (o.edges % o.div === 0) o.on = !o.on;
      o.blink = 1;
      world.pushEvent('RELAY', { cx: o.x + o.w / 2, cy: o.y + o.h / 2 }, { target: o.id, on: o.on, edges: o.edges }, o.id);
      world.emitNoise(o.x + o.w / 2, o.y + o.h / 2, 70, 'relay');
    }
    o.blink = Math.max(0, o.blink - 0.05);
    if (o.on) world.addSignal(o.channel);
  }
}

// --- Consumers -------------------------------------------------------------

export class Door {
  constructor(o) {
    this.o = o;
    o.openAmt = o.startOpen ? 1 : 0;
    o.open = !!o.startOpen;
    o.shake = 0;
  }
  update(world) {
    const o = this.o;
    let want = o.channel ? !!world.signals[o.channel] : false;
    if (o.invert) want = !want;
    const target = want ? 1 : 0;
    if (Math.abs(o.openAmt - target) > 0.001) {
      const speed = want ? 0.075 : 0.115;
      o.openAmt = clamp(o.openAmt + (want ? speed : -speed), 0, 1);
      if (o.openAmt > 0.02 && want && !o.wasMoving) {
        world.pushEvent('DOOR', { cx: o.x + o.w / 2, cy: o.y + o.h }, { target: o.id, state: 'opening' }, o.id);
        world.emitNoise(o.x + o.w / 2, o.y + o.h, 110, 'door');
      }
      o.wasMoving = want;
    } else if (o.wasMoving && !want) {
      o.wasMoving = false;
    }
    o.open = o.openAmt > 0.55;
    if (o.openAmt > 0.02) world.channelHeat[o.channel] = 1;
  }
  get solid() {
    return this.o.openAmt < 0.72;
  }
  get rect() {
    const o = this.o;
    const hh = o.h * (1 - o.openAmt);
    return { x: o.x, y: o.y, w: o.w, h: hh };
  }
}

export class TemporalGate {
  constructor(o) {
    this.o = o;
    o.openAmt = 0;
    o.open = false;
    o.flicker = 0;
  }
  update(world) {
    const o = this.o;
    const enough = world.echoes.length >= o.needEchoes;
    const chan = o.channel ? !!world.signals[o.channel] : true;
    let corrupt = true;
    if (o.needCorrupt > 0) {
      let n = 0;
      for (const e of world.echoes) {
        if (e.alive && (e.state === 'corrupted' || e.divergence > 0.5)) n++;
      }
      corrupt = n >= o.needCorrupt;
    }
    let want = enough && chan && corrupt;
    if (want && o.latch) o.latched = true;
    if (o.latched) want = true;
    o.satisfied = want;
    o.corruptSatisfied = corrupt;
    o.echoSatisfied = enough;
    o.openAmt = clamp(o.openAmt + (want ? 0.06 : -0.1), 0, 1);
    o.open = o.openAmt > 0.5;
    o.flicker = (o.flicker + (want ? 0.06 : 0.031)) % 1;
    if (want) world.channelHeat[o.channel] = 1;
  }
  get solid() {
    return this.o.openAmt < 0.7;
  }
  get rect() {
    const o = this.o;
    return { x: o.x, y: o.y, w: o.w, h: o.h * (1 - o.openAmt) };
  }
}

export class Laser {
  constructor(o) {
    this.o = o;
    o.firing = false;
    o.charge = 0;
    o.beam = { x: 0, y: 0, len: 0, hitAt: 0 };
  }
  scheduled(tick) {
    const o = this.o;
    if (!o.period) return true;
    const t = (tick + o.phase) % o.period;
    return t < o.period * o.duty;
  }
  update(world) {
    const o = this.o;
    const chanOk = o.channel ? !!world.signals[o.channel] : true;
    const want = chanOk && this.scheduled(world.tick);
    o.charge = clamp(o.charge + (want ? 0.1 : -0.14), 0, 1);
    o.firing = o.charge > 0.86;
    if (!o.firing) {
      o.beam.len = 0;
      return;
    }
    const dirs = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    const [dx, dy] = dirs[o.dir] || dirs.right;
    const sx = o.x + (dx > 0 ? TILE / 2 : dx < 0 ? -TILE / 2 : 0);
    const sy = o.y + (dy > 0 ? TILE / 2 : dy < 0 ? -TILE / 2 : 0);
    let len = o.len;
    // blocked by walls
    const hitTile = world.grid.raycast(sx, sy, dx, dy, len, (tx, ty) => world.grid.solidTile(tx, ty), 3);
    if (hitTile >= 0) len = hitTile;
    // blocked by dynamic solids (boxes, closed doors)
    const hitObj = world.raycastObjects(sx, sy, dx, dy, len);
    if (hitObj.dist >= 0 && hitObj.dist < len) len = hitObj.dist;
    // and by bodies: a body absorbs the rest of the beam
    const hitChar = world.raycastCharacters(sx, sy, dx, dy, len);
    if (hitChar.dist >= 0 && hitChar.dist < len) {
      len = hitChar.dist;
      o.blockedBy = hitChar.char.id;
    } else {
      o.blockedBy = null;
    }
    o.beam.x = sx;
    o.beam.y = sy;
    o.beam.len = len;
    o.beam.dirX = dx;
    o.beam.dirY = dy;
    world.hazardSegments.push({ x1: sx, y1: sy, x2: sx + dx * len, y2: sy + dy * len, kind: 'laser', source: o.id });
  }
}

export class MovingPlatform {
  constructor(o) {
    this.o = o;
    o.px = o.x;
    o.py = o.y;
    o.dx = 0;
    o.dy = 0;
  }
  update(world) {
    const o = this.o;
    const raw = (((world.tick / o.period) + o.phase) % 1 + 1) % 1;
    const tri = raw < 0.5 ? raw * 2 : 2 - raw * 2;
    // travel < 1 means the platform pauses at each end: that pause is the
    // window players time their transfers on
    const tr = o.travel ?? 1;
    const v = tr >= 1 ? tri : clamp((tri - (1 - tr) / 2) / tr, 0, 1);
    const e = v * v * (3 - 2 * v);
    const nx = lerp(o.fromX, o.toX, e);
    const ny = lerp(o.fromY, o.toY, e);
    const prevY = o.y;
    o.dx = nx - o.x;
    o.dy = ny - o.y;
    o.px = nx;
    o.py = ny;
    o.x = nx;
    o.y = ny;
    world.carryPlatform(o, o.dx, o.dy, prevY);
  }
  get rect() {
    return this.o;
  }
  get solid() {
    return true;
  }
}

export class Dampener {
  constructor(o) {
    this.o = o;
    o.field = false;
    o.pulse = 0;
  }
  update(world) {
    const o = this.o;
    const want = o.channel ? !!world.signals[o.channel] : true;
    o.field = want;
    o.on = want;
    o.pulse = (o.pulse + (want ? 0.045 : 0.012)) % 1;
    if (want) world.stabilizeField({
      x: o.x + o.w / 2,
      y: o.y + o.h / 2,
      r: o.radius,
      strength: 0.012,
    });
  }
}

export class Core {
  constructor(o) {
    this.o = o;
    o.dead = false;
    o.bob = 0;
  }
  update(world) {
    const o = this.o;
    o.bob = (o.bob + 0.03) % (Math.PI * 2);
    if (o.dead) return;
    const p = world.player;
    if (p.alive && overlapsRect(p, { x: o.x - 4, y: o.y - 4, w: o.w + 8, h: o.h + 8 })) {
      o.dead = true;
      world.coresCollected++;
      world.pushEvent('PICKUP', p, { target: o.id }, o.id);
      world.flash({ x: o.x + o.w / 2, y: o.y + o.h / 2, kind: 'core' });
      world.emitNoise(o.x + o.w / 2, o.y + o.h / 2, 80, 'core');
    }
  }
}

export class ExitPortal {
  constructor(o, world) {
    this.o = o;
    o.required = world.coreTarget;
    o.active = false;
    o.spin = 0;
    o.resolved = 0;
  }
  update(world) {
    const o = this.o;
    const cores = world.coresCollected >= world.coreTarget;
    const chan = o.channel ? !!world.signals[o.channel] : true;
    const want = cores && chan;
    if (want !== o.active) {
      if (want) world.pushEvent('EXIT_OPEN', { cx: o.x + o.w / 2, cy: o.y + o.h / 2 }, {}, o.id);
    }
    o.active = want;
    o.resolved = clamp(o.resolved + (want ? 0.06 : -0.08), 0, 1);
    o.spin += 0.02 + o.resolved * 0.06;
    if (want && world.player.alive && overlapsRect(world.player, o)) {
      world.completeLevel();
    }
  }
}

export function makeBehavior(o, world) {
  switch (o.type) {
    case 'plate':
      return new Plate(o);
    case 'button':
      return new Button(o);
    case 'switch':
      return new Switch(o);
    case 'relay':
      return new Relay(o);
    case 'door':
      return new Door(o);
    case 'gate':
      return new TemporalGate(o);
    case 'laser':
      return new Laser(o);
    case 'platform':
      return new MovingPlatform(o);
    case 'dampener':
      return new Dampener(o);
    case 'core':
      return new Core(o);
    case 'exit':
      return new ExitPortal(o, world);
    default:
      return null;
  }
}

export function divergenceSpikeFor(kind) {
  if (kind === 'interact') return DIVERGENCE_SPIKE;
  return DIVERGENCE_SPIKE * 0.5;
}
