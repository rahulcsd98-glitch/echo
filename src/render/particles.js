// Pooled particle system. Nothing is allocated after construction: particles
// are recycled through a fixed array with swap-removal, so a busy room never
// triggers GC in the middle of a room.
const TYPES = {
  SPARK: 0,
  DUST: 1,
  SHARD: 2,
  RING: 3,
  GLYPH: 4,
  EMBER: 5,
  STREAK: 6,
  GLITCH: 7,
};

class P {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.max = 1;
    this.size = 2;
    this.type = 0;
    this.color = '#fff';
    this.rot = 0;
    this.vr = 0;
    this.grav = 0;
    this.drag = 1;
    this.alpha = 1;
    this.len = 0;
    this.glow = 0;
  }
}

export class Particles {
  constructor(max = 1100) {
    this.pool = new Array(max);
    for (let i = 0; i < max; i++) this.pool[i] = new P();
    this.count = 0;
    this.max = max;
  }

  acquire() {
    if (this.count >= this.max) {
      // steal the oldest slot rather than dropping the newest effect
      return this.pool[0];
    }
    const p = this.pool[this.count++];
    p.active = true;
    return p;
  }

  clear() {
    for (let i = 0; i < this.count; i++) this.pool[i].active = false;
    this.count = 0;
  }

  emit(cfg) {
    const p = this.acquire();
    p.x = cfg.x;
    p.y = cfg.y;
    p.vx = cfg.vx || 0;
    p.vy = cfg.vy || 0;
    p.life = cfg.life || 0.5;
    p.max = p.life;
    p.size = cfg.size || 2;
    p.type = cfg.type || TYPES.SPARK;
    p.color = cfg.color || '#fff';
    p.rot = cfg.rot || 0;
    p.vr = cfg.vr || 0;
    p.grav = cfg.grav || 0;
    p.drag = cfg.drag === undefined ? 0.94 : cfg.drag;
    p.alpha = cfg.alpha === undefined ? 1 : cfg.alpha;
    p.len = cfg.len || 6;
    p.glow = cfg.glow || 0;
    return p;
  }

  // --- authored effects ----------------------------------------------------

  sparks(x, y, color, n = 6, speed = 60) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (x + y) % 1;
      this.emit({
        x,
        y,
        vx: Math.cos(a) * speed * (0.5 + ((i * 37) % 10) / 10),
        vy: Math.sin(a) * speed * (0.5 + ((i * 53) % 10) / 10) - 20,
        life: 0.4 + ((i * 13) % 10) / 28,
        size: 1.4 + ((i * 7) % 3) * 0.5,
        type: TYPES.SPARK,
        color,
        grav: 120,
        drag: 0.93,
      });
    }
  }

  dust(x, y, color, n = 5, up = 30) {
    for (let i = 0; i < n; i++) {
      this.emit({
        x: x + ((i * 17) % 12) - 6,
        y: y + ((i * 11) % 6) - 3,
        vx: ((i * 29) % 14) - 7,
        vy: -up * (0.4 + ((i * 19) % 10) / 12),
        life: 0.6 + ((i * 23) % 10) / 20,
        size: 2 + ((i * 5) % 3),
        type: TYPES.DUST,
        color,
        grav: -14,
        drag: 0.95,
        alpha: 0.5,
      });
    }
  }

  ring(x, y, color, size = 26, life = 0.45, type = TYPES.RING) {
    this.emit({ x, y, vx: 0, vy: 0, life, size, type, color, drag: 1, glow: 1 });
  }

  echoSpawn(x, y, color) {
    this.ring(x, y, color, 30, 0.55);
    for (let i = 0; i < 10; i++) {
      this.emit({
        x: x + ((i * 31) % 20) - 10,
        y: y + 12,
        vx: ((i * 13) % 8) - 4,
        vy: -50 - ((i * 41) % 30),
        life: 0.7 + ((i * 17) % 10) / 20,
        size: 1.5 + ((i * 3) % 3),
        type: TYPES.STREAK,
        color,
        drag: 0.96,
        len: 10 + ((i * 7) % 12),
      });
    }
  }

  echoDeath(x, y, color) {
    this.ring(x, y, color, 34, 0.5);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.emit({
        x,
        y,
        vx: Math.cos(a) * (40 + ((i * 23) % 40)),
        vy: Math.sin(a) * (40 + ((i * 29) % 40)) - 30,
        life: 0.6 + ((i * 11) % 10) / 22,
        size: 2 + ((i * 5) % 4),
        type: TYPES.SHARD,
        color,
        rot: a,
        vr: (i % 2 ? 1 : -1) * 6,
        grav: 160,
        drag: 0.95,
      });
    }
  }

  corrupt(x, y, color) {
    for (let i = 0; i < 6; i++) {
      this.emit({
        x: x + ((i * 37) % 26) - 13,
        y: y + ((i * 53) % 26) - 13,
        vx: ((i * 17) % 30) - 15,
        vy: -20 - ((i * 31) % 22),
        life: 0.28 + ((i * 7) % 10) / 40,
        size: 4 + ((i * 3) % 9),
        type: TYPES.GLITCH,
        color,
        drag: 0.97,
        alpha: 0.85,
      });
    }
  }

  impact(x, y, color, dir = 1) {
    this.ring(x, y, color, 14, 0.24);
    for (let i = 0; i < 7; i++) {
      this.emit({
        x,
        y,
        vx: dir * (30 + ((i * 19) % 60)),
        vy: ((i * 23) % 90) - 45,
        life: 0.3 + ((i * 13) % 10) / 32,
        size: 1.2 + ((i * 5) % 3) * 0.6,
        type: TYPES.EMBER,
        color,
        grav: 120,
        drag: 0.92,
      });
    }
  }

  glyph(x, y, color) {
    for (let i = 0; i < 4; i++) {
      this.emit({
        x: x + ((i * 21) % 28) - 14,
        y: y + ((i * 33) % 24) - 12,
        vx: 0,
        vy: -16,
        life: 0.5 + ((i * 9) % 10) / 20,
        size: 6 + ((i * 5) % 6),
        type: TYPES.GLYPH,
        color,
        drag: 1,
        alpha: 0.7,
      });
    }
  }

  // --- simulation ----------------------------------------------------------

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = this.pool[--this.count];
        this.pool[this.count] = p;
        this.pool[i] = last;
        last.active = false;
        i--;
        continue;
      }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  draw(ctx) {
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      const t = p.life / p.max;
      const a = Math.max(0, Math.min(1, t * 1.4)) * p.alpha;
      ctx.globalAlpha = a;
      switch (p.type) {
        case TYPES.RING: {
          const r = p.size * (1 - t) + 3;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1 + t * 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case TYPES.SHARD: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        }
        case TYPES.GLITCH: {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - 1, p.size * (0.4 + t * 0.8), 2);
          ctx.globalAlpha = a * 0.5;
          ctx.fillRect(p.x - p.size / 2, p.y - 4, p.size, 1);
          break;
        }
        case TYPES.STREAK: {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * 0.7;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02 - p.len * 0.4);
          ctx.stroke();
          break;
        }
        case TYPES.GLYPH: {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          const s = p.size;
          ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s * 0.6);
          ctx.beginPath();
          ctx.moveTo(p.x - s / 2, p.y);
          ctx.lineTo(p.x + s / 2, p.y);
          ctx.stroke();
          break;
        }
        case TYPES.DUST: {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        }
        default: {
          ctx.fillStyle = p.color;
          const s = p.size * (0.4 + t * 0.6);
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

export { TYPES as PARTICLE_TYPES };
