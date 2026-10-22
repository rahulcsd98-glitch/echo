import {
  ECHO_HP,
  IFRAME_TICKS,
  INTERACT_RANGE,
  MAX_ECHOES,
  PLAYER_HP,
  TILE,
  TRACE_INTERVAL,
} from './constants.js';
import { Box, Player, overlapsRect, stepX, stepY } from './entities.js';
import { Guard, TemporalHunter, Sentinel, makeEnemy } from './ai.js';
import {
  Core,
  ExitPortal,
  isStateful,
  makeBehavior,
  objectState,
} from './objects.js';
import { hashInts } from './prng.js';

// ---------------------------------------------------------------------------
// World: the deterministic room simulation.
//
// Tick order is fixed and documented below; every attempt (player + echoes)
// runs through exactly the same code path, which is what makes the recorded
// replays line up with the live timeline.
// ---------------------------------------------------------------------------

const TRIGGERS = new Set(['plate', 'button', 'switch', 'relay']);
const CONTACT = new Set(['core', 'exit']);

export class World {
  constructor(level, seed = 1234) {
    this.level = level;
    this.grid = level.grid;
    this.seed = seed;
    this.tick = 0;

    // objects are copied per world: an attempt always starts from the authored
    // state, never from whatever the last attempt left behind
    this.objects = [...level.objects.map((o) => ({ ...o })), { ...level.exit, type: 'exit' }];
    this.behaviors = [];
    this.byId = new Map();
    this.solidObjects = [];
    this.stateObjects = [];

    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      const beh = makeBehavior(o, this);
      if (beh) {
        beh.kind = o.type;
        beh.id = o.id;
        this.behaviors.push(beh);
        this.byId.set(o.id, beh);
        if (o.type === 'door' || o.type === 'gate' || o.type === 'platform') {
          this.solidObjects.push(beh);
        }
        if (isStateful(o)) {
          o.bitIndex = this.stateObjects.length;
          this.stateObjects.push(o);
        }
      }
    }

    this.boxes = [];
    this.enemies = [];
    this.sentinels = [];
    for (let i = 0; i < level.entities.length; i++) {
      const def = level.entities[i];
      if (def.type === 'box') {
        const box = new Box(def.x * TILE + 1, def.y * TILE + 2);
        box.id = `box${this.boxes.length}`;
        this.boxes.push(box);
      } else {
        const e = makeEnemy(def, this);
        if (e instanceof Sentinel) this.sentinels.push(e);
        else this.enemies.push(e);
      }
    }

    this.player = new Player(level.spawn.x, level.spawn.y);
    this.player.hp = 2;
    this.player.invuln = 0;
    this.echoes = [];
    this.characters = [this.player];
    this.pressBodies = [this.player];

    this.signals = {};
    this.prevSignals = {};
    this.channelHeat = {};

    this.events = [];
    this.noises = [];
    this.lastNoises = [];
    this.flashes = [];
    this.fields = [];
    this.hazardSegments = [];
    this.shake = 0;
    this.glitch = 0;

    this.coreTarget = this.objects.filter((o) => o.type === 'core').length;
    this.coresCollected = 0;
    this.complete = false;
    this.completedTick = -1;
    this.playerDead = false;
    this.failReason = '';
    this.attempts = 1;
  }

  // --- queries -------------------------------------------------------------

  addSignal(channel) {
    if (!channel) return;
    this.signals[channel] = true;
  }

  solidOverlapRect(x, y, w, h, ignore) {
    const r = { x, y, w, h };
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b === ignore || !b.alive) continue;
      if (ignore && ignore.carrying === b) continue;
      if (b.carriedBy && b.carriedBy !== ignore) continue;
      if (overlapsRect(r, b)) return b;
    }
    for (let i = 0; i < this.solidObjects.length; i++) {
      const beh = this.solidObjects[i];
      if (!beh.solid) continue;
      const rect = beh.rect;
      if (rect.h <= 0) continue;
      if (overlapsRect(r, rect)) return beh;
    }
    return null;
  }

  solidOverlap(body) {
    return this.solidOverlapRect(body.x, body.y, body.w, body.h, body);
  }

  // Moving platforms sweep their riders along with them.
  carryPlatform(p, dx, dy, prevY) {
    if (!dx && !dy) return;
    for (let i = 0; i < this.pressBodies.length; i++) {
      const b = this.pressBodies[i];
      if (!b.alive) continue;
      const feet = b.y + b.h;
      if (feet < prevY - 4 || feet > prevY + 12) continue;
      if (b.x + b.w <= p.x + 1 || b.x >= p.x + p.w - 1) continue;
      if (dx) {
        const nx = b.x + dx;
        if (!this.grid.overlapsSolid(nx, b.y, b.w, b.h) && !this.solidOverlapRect(nx, b.y, b.w, b.h, b)) b.x = nx;
      }
      if (dy) {
        const ny = b.y + dy;
        if (!this.grid.overlapsSolid(b.x, ny, b.w, b.h) && !this.solidOverlapRect(b.x, ny, b.w, b.h, b)) b.y = ny;
      }
      b.ridingTick = this.tick;
    }
  }

  raycastObjects(x, y, dx, dy, maxLen, opaqueOnly = false) {
    const step = 4;
    const steps = Math.ceil(maxLen / step);
    for (let i = 1; i <= steps; i++) {
      const t = i * step;
      const px = x + dx * t;
      const py = y + dy * t;
      for (let k = 0; k < this.boxes.length; k++) {
        const b = this.boxes[k];
        if (!b.alive || b.carriedBy) continue;
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          return { dist: t, obj: b };
        }
      }
      for (let k = 0; k < this.solidObjects.length; k++) {
        const beh = this.solidObjects[k];
        if (opaqueOnly && beh.kind === 'platform') continue;
        if (!beh.solid) continue;
        const r = beh.rect;
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          return { dist: t, obj: beh };
        }
      }
    }
    return { dist: -1, obj: null };
  }

  // first character along a ray (beams stop at bodies, which is what makes an
  // echo a usable shield)
  raycastCharacters(x, y, dx, dy, maxLen, ignore) {
    const step = 4;
    const steps = Math.ceil(maxLen / step);
    for (let i = 1; i <= steps; i++) {
      const t = i * step;
      const px = x + dx * t;
      const py = y + dy * t;
      for (let k = 0; k < this.characters.length; k++) {
        const c = this.characters[k];
        if (!c.alive || c === ignore) continue;
        if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
          return { dist: t, char: c };
        }
      }
    }
    return { dist: -1, char: null };
  }

  lineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    const nx = dx / len;
    const ny = dy / len;
    const hit = this.grid.raycast(x1, y1, nx, ny, len, (tx, ty) => this.grid.solidTile(tx, ty), 4);
    if (hit >= 0 && hit < len - 4) return false;
    const obj = this.raycastObjects(x1, y1, nx, ny, len - 4, true);
    return !(obj.dist >= 0);
  }

  inRange(a, o, range) {
    const dx = a.cx - (o.x + o.w / 2);
    const dy = a.cy - (o.y + o.h / 2);
    return dx * dx + dy * dy <= range * range;
  }

  bodyById(id) {
    if (this.player.id === id) return this.player;
    for (const e of this.echoes) if (e.id === id) return e;
    for (const b of this.boxes) if (b.id === id) return b;
    return null;
  }

  objectStateMask() {
    let mask = 0;
    for (let i = 0; i < this.stateObjects.length && i < 30; i++) {
      if (objectState(this.stateObjects[i])) mask |= 1 << i;
    }
    return mask;
  }

  boxHash() {
    const vals = [];
    for (const b of this.boxes) {
      vals.push(b.alive ? Math.round(b.x) : -9999, b.alive ? Math.round(b.y) : -9999);
    }
    return hashInts(vals);
  }

  // --- events / feedback ---------------------------------------------------

  pushEvent(type, body, meta = {}, targetId = null) {
    const ev = {
      t: this.tick,
      type,
      x: body && body.cx !== undefined ? Math.round(body.cx) : 0,
      y: body && body.cy !== undefined ? Math.round(body.cy) : 0,
      target: targetId || (body && body.id) || null,
      meta,
    };
    this.events.push(ev);
    // presentation hook (audio/vfx); never read by the simulation
    if (this.onEvent) this.onEvent(ev);
  }

  drainEvents() {
    if (this.events.length === 0) return null;
    const e = this.events;
    this.events = [];
    return e;
  }

  emitNoise(x, y, r, kind) {
    this.noises.push({ x, y, r, kind, t: this.tick });
  }

  flash(f) {
    this.flashes.push(f);
    if (this.flashes.length > 24) this.flashes.shift();
  }

  addShake(v) {
    this.shake = Math.min(1.4, Math.max(this.shake, v));
  }

  stabilizeField(f) {
    this.fields.push(f);
  }

  temporalNoiseAt(x, y) {
    let n = 0;
    for (const e of this.echoes) {
      if (e.state !== 'corrupted' || !e.alive) continue;
      const d = Math.hypot(e.cx - x, e.cy - y);
      if (d < 150) n += 1 - d / 150;
    }
    for (const e of this.echoes) {
      if (e.alive && e.sync < 0.5) {
        const d = Math.hypot(e.cx - x, e.cy - y);
        if (d < 90) n += 0.4;
      }
    }
    return Math.min(1, n);
  }

  // --- interactions --------------------------------------------------------

  interactables() {
    return this.behaviors.filter((b) => typeof b.onInteract === 'function');
  }

  tryInteract(body) {
    let best = null;
    let bestScore = Infinity;
    for (const b of this.behaviors) {
      if (typeof b.onInteract !== 'function') continue;
      const o = b.o;
      if (!this.inRange(body, o, INTERACT_RANGE + 4)) continue;
      const dx = o.x + o.w / 2 - body.cx;
      const score = Math.abs(dx) + (Math.sign(dx) === body.facing ? 0 : 18);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (!best) {
      this.pushEvent('INTERACT_MISS', body);
      return null;
    }
    best.onInteract(this, body);
    body.interactTarget = best.id;
    return best.o;
  }

  tryGrab(body) {
    if (body.carrying) {
      this.dropBox(body.carrying, body);
      return true;
    }
    let best = null;
    let bestScore = Infinity;
    for (const b of this.boxes) {
      if (!b.alive || b.carriedBy) continue;
      const dx = b.cx - body.cx;
      const dy = b.cy - body.cy;
      if (Math.abs(dx) > 40 || dy > 6 || dy < -40) continue;
      const score = Math.abs(dx);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (!best) {
      this.pushEvent('GRAB_MISS', body);
      return false;
    }
    best.carriedBy = body;
    body.carrying = best;
    best.vx = 0;
    best.vy = 0;
    this.pushEvent('PICKUP', body, { target: best.id || 'box' });
    return true;
  }

  dropBox(box, carrier) {
    box.carriedBy = null;
    if (carrier) carrier.carrying = null;
    // land beside the carrier, never inside them: overlapping a dropped box
    // would block the very next jump
    box.x = carrier.facing < 0 ? carrier.x - box.w - 1 : carrier.x + carrier.w + 1;
    box.y = carrier.y + carrier.h - box.h;
    box.vy = 0.5;
    box.vx = carrier.vx * 0.5;
    this.settleBox(box, carrier);
    this.pushEvent('DROP', carrier, { target: box.id || 'box' });
  }

  // A dropped box must never end up embedded in geometry: nudge it until it is
  // free. Carried boxes ignore collision (they ride at head height), so this is
  // the one place overlaps can appear.
  settleBox(box, carrier) {
    const stuck = () => {
      if (this.grid.overlapsSolid(box.x, box.y, box.w, box.h)) return true;
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (b === box || !b.alive || b.carriedBy) continue;
        if (overlapsRect(box, b)) return true;
      }
      for (let i = 0; i < this.solidObjects.length; i++) {
        const beh = this.solidObjects[i];
        if (!beh.solid || beh === carrier) continue;
        const rect = beh.rect;
        if (rect.h > 0 && overlapsRect(box, rect)) return true;
      }
      return false;
    };
    if (!stuck()) return;
    const startX = box.x;
    for (let up = 2; up <= 30; up += 2) {
      box.y -= 2;
      if (!stuck()) return;
    }
    box.y += 30;
    const dir = carrier && carrier.facing < 0 ? -1 : 1;
    for (let d = 2; d <= 30; d += 2) {
      box.x = startX + dir * d;
      if (!stuck()) return;
    }
    box.x = startX;
  }

  // --- echo lifecycle (called by EchoManager / Echo) -----------------------

  addEcho(echo) {
    this.echoes.push(echo);
    this.characters = [this.player, ...this.echoes];
  }

  removeEcho(echo) {
    const i = this.echoes.indexOf(echo);
    if (i >= 0) this.echoes.splice(i, 1);
    this.characters = [this.player, ...this.echoes];
  }

  consumeEcho(echo, source) {
    if (!echo.alive) return;
    echo.alive = false;
    echo.state = 'dead';
    echo.deathTick = this.tick;
    echo.divergence = 1;
    this.pushEvent('ECHO_LOST', echo, { source: source && source.type ? source.type : String(source) }, echo.id);
    this.flash({ x: echo.cx, y: echo.cy, kind: 'echo_death' });
    this.addShake(0.5);
    this.glitch = Math.min(1.5, this.glitch + 0.55);
  }

  killEchoFromHazard(echo, kind) {
    if (!echo.alive || echo.state === 'done') return;
    this.consumeEcho(echo, kind);
  }

  killPlayer(cause) {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.deathTick = 0;
    p.deathKind = cause;
    this.playerDead = true;
    this.failReason = cause;
    this.pushEvent('DEATH', p, { cause });
    this.flash({ x: p.cx, y: p.cy, kind: 'player_death' });
    this.addShake(0.9);
    this.glitch = Math.min(1.6, this.glitch + 0.8);
  }

  damagePlayer(amount, cause, fromX) {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    p.hp -= amount;
    p.invuln = IFRAME_TICKS;
    p.hitFlash = 1;
    p.vx = (p.cx < fromX ? -1 : 1) * 4.2;
    p.vy = -3.6;
    p.onGround = false;
    this.pushEvent('DAMAGE', p, { amount, cause });
    this.flash({ x: p.cx, y: p.cy, kind: 'damage' });
    this.addShake(0.45);
    if (p.hp <= 0) this.killPlayer(cause);
  }

  damageCharacter(c, amount, cause, fromX) {
    if (!c.alive || c.invuln > 0) return;
    c.hp -= amount;
    c.invuln = IFRAME_TICKS;
    c.hitFlash = 1;
    c.vx = (c.cx < (fromX ?? c.cx) ? -1 : 1) * 3.4;
    c.vy = -2.6;
    c.onGround = false;
    if (c.kind === 'player') {
      this.pushEvent('DAMAGE', c, { amount, cause, source: 'beam' });
      this.flash({ x: c.cx, y: c.cy, kind: 'damage' });
      this.addShake(0.4);
      if (c.hp <= 0) this.killPlayer(cause);
    } else {
      this.pushEvent('ECHO_DAMAGE', c, { amount, cause }, c.id);
      c.divergence = Math.min(1, c.divergence + 0.12);
      this.flash({ x: c.cx, y: c.cy, kind: 'echo_damage' });
      this.addShake(0.25);
      if (c.hp <= 0) this.consumeEcho(c, cause);
    }
  }

  completeLevel() {
    if (this.complete) return;
    this.complete = true;
    this.completedTick = this.tick;
    this.pushEvent('LEVEL_COMPLETE', this.player);
    this.flash({ x: this.player.cx, y: this.player.cy, kind: 'complete' });
    this.addShake(0.4);
  }

  // --- simulation ----------------------------------------------------------

  step(playerInput) {
    this.tick++;
    this.lastNoises = this.noises;
    this.noises = [];
    this.fields = [];
    this.hazardSegments = [];
    this.shake *= 0.9;
    this.glitch *= 0.93;
    for (const k in this.channelHeat) this.channelHeat[k] *= 0.92;

    this.characters = [this.player, ...this.echoes];
    this.pressBodies = [this.player, ...this.echoes, ...this.boxes];

    // 1. triggers fold their state into channels
    this.prevSignals = this.signals;
    this.signals = {};
    for (let i = 0; i < this.behaviors.length; i++) {
      const b = this.behaviors[i];
      if (TRIGGERS.has(b.kind)) b.update(this);
    }
    // 2. kinematic + consumer objects read the freshly resolved channels
    for (let i = 0; i < this.behaviors.length; i++) {
      const b = this.behaviors[i];
      if (TRIGGERS.has(b.kind) || CONTACT.has(b.kind)) continue;
      b.update(this);
    }
    // 3. characters, boxes, enemies
    this.player.update(this, playerInput);
    for (let i = 0; i < this.echoes.length; i++) this.echoes[i].update(this);
    for (let i = 0; i < this.boxes.length; i++) this.boxes[i].update(this);
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(this);
    for (let i = 0; i < this.sentinels.length; i++) this.sentinels[i].update(this);
    // 4. contact objects (cores, exit)
    for (let i = 0; i < this.behaviors.length; i++) {
      const b = this.behaviors[i];
      if (CONTACT.has(b.kind)) b.update(this);
    }
    // 5. hazards, damage, divergence sampling
    this.resolveHazards();
    for (let i = 0; i < this.echoes.length; i++) this.echoes[i].postUpdate(this);

    this.characters = [this.player, ...this.echoes];
  }

  resolveHazards() {
    const chars = this.characters;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (!c.alive) continue;
      if (this.grid.lethalAtRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2)) {
        if (c.kind === 'player') {
          this.killPlayer(this.grid.lethalAtPoint(c.cx, c.cy) ? 'temporal_void' : 'hazard');
        } else this.killEchoFromHazard(c, 'hazard');
        continue;
      }
      if (c.y > this.grid.pxHeight + 120) {
        if (c.kind === 'player') this.killPlayer('void');
        else this.killEchoFromHazard(c, 'void');
        continue;
      }
    }

    // boxes disappearing into the void
    for (const b of this.boxes) {
      if (!b.alive) continue;
      if (this.grid.lethalAtRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4) || b.y > this.grid.pxHeight + 160) {
        b.alive = false;
        if (b.carriedBy) {
          b.carriedBy.carrying = null;
          b.carriedBy = null;
        }
        this.flash({ x: b.cx, y: b.cy, kind: 'box_lost' });
      }
    }

    // beams / lasers: they wound rather than erase, so a body can be a shield
    if (this.hazardSegments.length) {
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!c.alive) continue;
        for (const h of this.hazardSegments) {
          if (segHitsRect(h, c)) {
            // beams erase people outright; temporal matter only frays, which is
            // what lets an echo soak a beam for a while
            this.damageCharacter(c, 1, h.kind, h.x1);
            break;
          }
        }
      }
    }

    // dampener fields: repel hunters, stabilise echoes
    if (this.fields.length) {
      for (const e of this.enemies) {
        if (e.type !== 'hunter') continue;
        for (const f of this.fields) {
          if (Math.hypot(e.cx - f.x, e.cy - f.y) < f.r) {
            e.stun = Math.max(e.stun, 3);
            break;
          }
        }
      }
      for (const c of this.characters) {
        if (!c.alive) continue;
        for (const f of this.fields) {
          if (Math.hypot(c.cx - f.x, c.cy - f.y) < f.r) {
            c.stabilized = true;
            if (c.kind === 'echo') c.divergence = Math.max(0, c.divergence - f.strength);
            // a field knits coherence back together, slowly
            c.fieldTicks = (c.fieldTicks || 0) + 1;
            const maxHp = c.kind === 'player' ? PLAYER_HP : ECHO_HP;
            if (c.fieldTicks % 45 === 0 && c.hp < maxHp) c.hp++;
          }
        }
      }
    }

    // guards threaten whoever they touch
    for (const g of this.enemies) {
      if (g.type !== 'guard' || !g.alive) continue;
      for (const c of this.characters) {
        if (!c.alive) continue;
        if (Math.abs(c.cy - g.cy) > 22) continue;
        if (!overlapsRect(c, { x: g.x + 1, y: g.y + 2, w: g.w - 2, h: g.h - 2 })) continue;
        if (c.kind === 'player') this.killPlayer('guard');
        else {
          c.divergence = Math.min(1, c.divergence + 0.5);
          c.vx += (c.cx < g.cx ? -1 : 1) * 2.4;
          c.vy = -1.6;
          c.exposed = true;
        }
      }
    }
  }
}

function segHitsRect(s, r) {
  // cheap: sample the segment, then inflate the rect a touch
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return false;
  const steps = Math.max(1, Math.ceil(len / 6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = s.x1 + dx * t;
    const py = s.y1 + dy * t;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return true;
  }
  return false;
}

export { TRACE_INTERVAL, MAX_ECHOES, Guard, TemporalHunter, Sentinel, Core, ExitPortal, stepX, stepY };
