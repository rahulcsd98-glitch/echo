import { clamp, damp, lerp } from '../sim/math.js';

// Camera: smooth follow, subtle look-ahead, room clamping and decaying shake.
// Every value is framerate independent so a 144Hz monitor sees the same motion.
export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.baseZoom = 1;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.offX = 0;
    this.offY = 0;
    this.viewW = 960;
    this.viewH = 540;
    this.bounds = null;
    this.introT = 0;
    this.punch = 0;
  }

  setViewport(w, h, level, zoomBias = 1) {
    this.canvasW = w;
    this.canvasH = h;
    // room-authored zoom: fill the screen but never lose the room entirely
    const fit = Math.min(w / (level.width + 120), h / (level.height + 140));
    this.baseZoom = clamp(fit, 1.05, 2.4) * zoomBias;
    this.targetZoom = this.baseZoom;
    this.bounds = { x0: 0, y0: 0, x1: level.width, y1: level.height };
  }

  snap(level, player) {
    this.viewW = (this.canvasW || 960) / this.zoom;
    this.viewH = (this.canvasH || 540) / this.zoom;
    this.x = player.cx;
    this.y = player.cy;
    this.introT = 1;
    this.clampToBounds();
  }

  addShake(v) {
    this.shakeAmt = Math.min(1.6, this.shakeAmt + v);
  }

  kick(v) {
    this.punch = Math.min(1, this.punch + v);
  }

  clampToBounds() {
    if (!this.bounds) return;
    const hw = this.viewW / 2;
    const hh = this.viewH / 2;
    const { x0, y0, x1, y1 } = this.bounds;
    const w = x1 - x0;
    const h = y1 - y0;
    this.x = w <= this.viewW ? (x0 + x1) / 2 : clamp(this.x, x0 + hw, x1 - hw);
    this.y = h <= this.viewH ? (y0 + y1) / 2 : clamp(this.y, y0 + hh, y1 - hh);
  }

  update(dt, world, opts = {}) {
    const p = world.player;
    const cam = opts.camera || this;
    cam.viewW = opts.canvasW / cam.zoom;
    cam.viewH = opts.canvasH / cam.zoom;

    const look = opts.lookAhead === false ? 0 : 1;
    const tx = p.cx + p.facing * 34 + clamp(p.vx * 9, -40, 40) * look;
    const ty = p.cy - 10 + clamp(p.vy * 4, -26, 26) * look;

    const follow = opts.reducedMotion ? 16 : 6.5;
    cam.x = damp(cam.x, tx, follow, dt);
    cam.y = damp(cam.y, ty, follow * 0.8, dt);

    const drift = (world.glitch || 0) * 30;
    if (drift > 0.2) {
      cam.x += Math.sin(this.shakeT * 37.1) * drift * dt * 8;
      cam.y += Math.cos(this.shakeT * 41.7) * drift * dt * 8;
    }

    cam.zoom = damp(cam.zoom, cam.targetZoom, 5, dt);
    cam.viewW = opts.canvasW / cam.zoom;
    cam.viewH = opts.canvasH / cam.zoom;
    cam.introT = Math.max(0, cam.introT - dt * 1.4);
    cam.punch = Math.max(0, cam.punch - dt * 2.6);

    if (opts.shake !== false) {
      cam.shakeAmt = Math.max(cam.shakeAmt * Math.pow(0.02, dt), 0);
      cam.shakeT += dt;
      const a = cam.shakeAmt * cam.shakeAmt * 16;
      cam.offX = Math.sin(cam.shakeT * 63.3) * a;
      cam.offY = Math.cos(cam.shakeT * 77.7) * a;
    } else {
      cam.shakeAmt = 0;
      cam.offX = 0;
      cam.offY = 0;
    }

    this.clampToBounds();
  }

  apply(ctx, canvasW, canvasH) {
    const zoom = this.zoom * (1 + this.punch * 0.04);
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.x + this.offX, -this.y + this.offY);
  }

  worldToScreen(wx, wy, canvasW, canvasH) {
    const zoom = this.zoom * (1 + this.punch * 0.04);
    return {
      x: (wx - this.x + this.offX) * zoom + canvasW / 2,
      y: (wy - this.y + this.offY) * zoom + canvasH / 2,
    };
  }

  visible(rect, pad = 80) {
    const hw = this.viewW / 2 + pad;
    const hh = this.viewH / 2 + pad;
    return (
      rect.x + rect.w > this.x - hw &&
      rect.x < this.x + hw &&
      rect.y + rect.h > this.y - hh &&
      rect.y < this.y + hh
    );
  }
}

export { lerp };
