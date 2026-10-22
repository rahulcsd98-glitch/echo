import { TILE } from '../sim/constants.js';
import { TILE_VOID, TILE_ONEWAY, TILE_TRIM, TILE_STRIP, TILE_PIPE, TILE_VENT, TILE_WALL } from '../sim/tiles.js';
import { clamp } from '../sim/math.js';
import { rgba, mixHex } from './palette.js';
import { Particles } from './particles.js';

// ---------------------------------------------------------------------------
// Renderer: draws the room, its machinery and everyone standing in it.
// Design language: a dark instrument panel. Everything structural is a thin
// line or a flat plate; everything that matters glows.
// ---------------------------------------------------------------------------

const FONT = "'Consolas', 'DejaVu Sans Mono', 'SFMono-Regular', monospace";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.particles = new Particles();
    this.staticLayer = null;
    this.staticKey = '';
    this.gradCache = null;
    this.time = 0;
    this.dpr = 1;
    this.flash = { v: 0, color: '#fff' };
  }

  resize(w, h, dpr) {
    this.dpr = dpr || 1;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.gradCache = null;
  }

  get width() {
    return this.canvas.width / this.dpr;
  }
  get height() {
    return this.canvas.height / this.dpr;
  }

  // Static geometry never changes between attempts: bake it once per level.
  bakeStatic(level, pal) {
    const key = `${level.id}:${pal.name}`;
    if (this.staticKey === key && this.staticLayer) return this.staticLayer;
    const c = document.createElement('canvas');
    c.width = level.grid.pxWidth;
    c.height = level.grid.pxHeight;
    const g = c.getContext('2d');
    const grid = level.grid;

    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const id = grid.at(tx, ty);
        const x = tx * TILE;
        const y = ty * TILE;
        if (id === TILE_WALL) {
          const openUp = !grid.solidTile(tx, ty - 1);
          const openDown = !grid.solidTile(tx, ty + 1);
          const openL = !grid.solidTile(tx - 1, ty);
          const openR = !grid.solidTile(tx + 1, ty);
          g.fillStyle = openUp ? pal.wallFace : pal.wall;
          g.fillRect(x, y, TILE, TILE);
          // a single hairline of structure per tile keeps walls readable
          g.strokeStyle = rgba(pal.wallEdge, 0.5);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x + 0.5, y + TILE - 0.5);
          g.lineTo(x + TILE - 0.5, y + TILE - 0.5);
          g.moveTo(x + TILE - 0.5, y + 0.5);
          g.lineTo(x + TILE - 0.5, y + TILE - 0.5);
          g.stroke();
          if (openUp) {
            g.strokeStyle = rgba(pal.trim, 0.85);
            g.lineWidth = 1.4;
            g.beginPath();
            g.moveTo(x, y + 1);
            g.lineTo(x + TILE, y + 1);
            g.stroke();
            g.strokeStyle = rgba(pal.interact, 0.16);
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(x + 3, y + 3);
            g.lineTo(x + TILE - 3, y + 3);
            g.stroke();
          }
          if (openDown && !openUp) {
            g.fillStyle = rgba('#000000', 0.35);
            g.fillRect(x, y + TILE - 3, TILE, 3);
          }
          if (openL || openR) {
            g.fillStyle = rgba('#000000', 0.22);
            g.fillRect(x + (openL ? 0 : TILE - 2), y, 2, TILE);
          }
          // rivets
          if (((tx * 7 + ty * 13) % 5) === 0) {
            g.fillStyle = rgba(pal.trim, 0.35);
            g.fillRect(x + 5, y + 6, 2, 2);
            g.fillRect(x + TILE - 7, y + TILE - 8, 2, 2);
          }
        } else if (id === TILE_TRIM) {
          g.fillStyle = rgba(pal.trim, 0.9);
          g.fillRect(x + 4, y + TILE - 4, TILE - 8, 2);
        } else if (id === TILE_STRIP) {
          g.fillStyle = rgba(pal.wallFace, 0.8);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle = rgba(pal.interact, 0.12);
          g.fillRect(x, y + TILE / 2 - 1, TILE, 2);
        } else if (id === TILE_PIPE) {
          g.fillStyle = rgba(pal.wallFace, 0.9);
          g.fillRect(x, y, TILE, TILE);
          g.strokeStyle = rgba(pal.trim, 0.7);
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x + TILE / 2, y);
          g.lineTo(x + TILE / 2, y + TILE);
          g.stroke();
        } else if (id === TILE_VENT) {
          g.fillStyle = rgba(pal.wallFace, 0.9);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle = rgba('#000', 0.5);
          for (let i = 0; i < 3; i++) g.fillRect(x + 3, y + 5 + i * 5, TILE - 6, 2);
        }
      }
    }
    this.staticLayer = c;
    this.staticKey = key;
    return c;
  }

  // --- frame ---------------------------------------------------------------

  render(game) {
    const { ctx } = this;
    const { session, camera, pal, settings, dt } = game;
    const world = session.world;
    const level = session.level;
    const W = this.width;
    const H = this.height;

    this.time += dt;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = pal.voidDeep;
    ctx.fillRect(0, 0, W, H);

    this.drawBackdrop(ctx, camera, pal, W, H, game);

    const staticLayer = this.bakeStatic(level, pal);
    ctx.save();
    camera.apply(ctx, W, H);
    ctx.drawImage(staticLayer, 0, 0);
    this.drawDynamicTiles(ctx, world, pal);
    this.drawObjects(ctx, world, pal, game);
    this.drawBoxes(ctx, world, pal);
    this.drawEnemies(ctx, world, pal);
    this.drawEchoes(ctx, world, pal, game);
    this.drawPlayer(ctx, world, pal, game);
    this.drawEffects(ctx, world, pal, game);
    this.particles.draw(ctx);
    ctx.restore();

    this.drawScreenFx(ctx, world, pal, W, H, settings, game);
    if (game.debug) this.drawDebug(ctx, game, W, H);
    ctx.restore();
  }

  drawBackdrop(ctx, cam, pal, W, H, game) {
    const key = `${pal.name}:${W}x${H}`;
    if (!this.gradCache || this.gradCache.k !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, pal.voidDeep);
      g.addColorStop(0.55, pal.void);
      g.addColorStop(1, mixHex(pal.void, pal.haze, 0.65));
      this.gradCache = { k: key, g };
    }
    ctx.fillStyle = this.gradCache.g;
    ctx.fillRect(0, 0, W, H);

    // slow drifting lattice: depth without clutter
    ctx.save();
    const par = 0.25;
    const ox = -cam.x * par;
    const oy = -cam.y * par;
    const step = 128;
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sx = ((ox % step) + step) % step;
    const sy = ((oy % step) + step) % step;
    for (let x = sx - step; x < W + step; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = sy - step; y < H + step; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = pal.interact;
    for (let x = sx - step; x < W + step; x += step * 2) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
    }
    ctx.restore();

    const t = this.time;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = pal.interact;
    for (let i = 0; i < 5; i++) {
      const y = ((t * (9 + i * 3)) % (H + 200)) - 100;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + Math.sin(t * 0.3 + i) * 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDynamicTiles(ctx, world, pal) {
    const grid = world.grid;
    const t = this.time;
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const id = grid.at(tx, ty);
        if (id !== TILE_VOID && id !== TILE_ONEWAY) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (id === TILE_VOID) {
          const g = ctx.createLinearGradient(x, y, x, y + TILE);
          g.addColorStop(0, rgba(pal.voidDeep, 0.98));
          g.addColorStop(1, '#000');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.globalAlpha = 0.22 + 0.12 * Math.sin(t * 1.4 + tx * 0.7);
          ctx.strokeStyle = pal.corrupt;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + TILE - 3);
          ctx.lineTo(x + TILE - 4, y + TILE - 3);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = rgba(pal.wallFace, 0.9);
          ctx.fillRect(x, y + 2, TILE, TILE - 4);
          ctx.fillStyle = rgba(pal.energy, 0.8);
          ctx.fillRect(x, y + 2, TILE, 2);
          ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 2.2 + tx);
          ctx.fillStyle = rgba(pal.energy, 1);
          ctx.fillRect(x, y + TILE - 4, TILE, 1);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(pal.trim, 0.4);
          ctx.lineWidth = 1;
          for (let i = 1; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + (i * TILE) / 3, y + 4);
            ctx.lineTo(x + (i * TILE) / 3, y + TILE - 4);
            ctx.stroke();
          }
        }
      }
    }
  }

  drawObjects(ctx, world, pal, game) {
    const objs = world.behaviors;
    // pass 1: things that sit on the floor / behind actors
    for (let i = 0; i < objs.length; i++) {
      const b = objs[i];
      if (b.kind === 'plate' || b.kind === 'dampener' || b.kind === 'platform') this.drawObject(ctx, b, pal, world);
    }
    // pass 2: interactables and machinery
    for (let i = 0; i < objs.length; i++) {
      const b = objs[i];
      if (b.kind === 'plate' || b.kind === 'dampener' || b.kind === 'platform') continue;
      this.drawObject(ctx, b, pal, world);
    }
  }

  drawObject(ctx, b, pal, world) {
    const o = b.o;
    const t = this.time;
    switch (b.kind) {
      case 'plate': {
        const p = o.press || 0;
        ctx.fillStyle = rgba('#000', 0.5);
        ctx.fillRect(o.x - 2, o.y + o.h - 3, o.w + 4, 4);
        const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        g.addColorStop(0, rgba(pal.wallFace, 0.95));
        g.addColorStop(1, rgba(pal.wall, 0.95));
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y + p * 3, o.w, o.h - p * 2);
        ctx.fillStyle = rgba(pal.interact, 0.25 + p * 0.7);
        ctx.fillRect(o.x + 3, o.y + o.h - 2 + p * 2, o.w - 6, 1.5);
        ctx.globalAlpha = 0.4 + p * 0.6;
        ctx.strokeStyle = p > 0.02 ? pal.interact : rgba(pal.trim, 0.7);
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x + 0.5, o.y + o.h - 5 + p * 2, o.w - 1, 4);
        ctx.globalAlpha = 1;
        if (o.occupants > 0) {
          ctx.globalAlpha = 0.2 + 0.1 * Math.sin(t * 6);
          ctx.fillStyle = pal.interact;
          ctx.fillRect(o.x, o.y + o.h - 1, o.w, 2);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'button': {
        const d = o.depress || 0;
        ctx.fillStyle = rgba(pal.wallFace, 1);
        ctx.fillRect(o.x + 2, o.y + 4, o.w - 4, o.h - 6);
        ctx.strokeStyle = rgba(pal.trim, 0.8);
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x + 2.5, o.y + 4.5, o.w - 5, o.h - 7);
        ctx.fillStyle = rgba(pal.interact, 0.15 + d * 0.8);
        ctx.fillRect(o.x + 6, o.y + 8 + d * 3, o.w - 12, o.h - 14 + d * 2);
        if (o.mode === 'timed' && o.power > 0) {
          const f = o.power / (o.duration || 150);
          ctx.fillStyle = rgba(pal.warn, 0.8);
          ctx.fillRect(o.x + 2, o.y + o.h - 2, (o.w - 4) * f, 1.5);
        }
        break;
      }
      case 'switch': {
        const l = o.lever || 0;
        ctx.fillStyle = rgba(pal.wallFace, 1);
        ctx.fillRect(o.x + 4, o.y + 6, o.w - 8, o.h - 10);
        ctx.strokeStyle = rgba(pal.trim, 0.9);
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x + 4.5, o.y + 6.5, o.w - 9, o.h - 11);
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h - 8);
        ctx.rotate((l - 0.5) * 1.5);
        ctx.fillStyle = o.on ? pal.energy : pal.trim;
        ctx.fillRect(-1.5, -12, 3, 12);
        ctx.beginPath();
        ctx.arc(0, -12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'relay': {
        ctx.fillStyle = rgba(pal.wallFace, 1);
        ctx.fillRect(o.x + 3, o.y + 4, o.w - 6, o.h - 8);
        ctx.strokeStyle = rgba(pal.trim, 0.9);
        ctx.strokeRect(o.x + 3.5, o.y + 4.5, o.w - 7, o.h - 9);
        ctx.fillStyle = o.on ? pal.energy : rgba(pal.danger, 0.6);
        ctx.fillRect(o.x + 7, o.y + 9, o.w - 14, 3);
        const edges = o.edges || 0;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(edges % 2 > 0 && i === 0 ? pal.energy : pal.trim, 0.8 - i * 0.2);
          ctx.fillRect(o.x + 6 + i * 5, o.y + o.h - 8, 3, 3);
        }
        if (o.blink > 0) {
          ctx.globalAlpha = o.blink * 0.8;
          ctx.strokeStyle = pal.energy;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 10 + (1 - o.blink) * 16, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'door': {
        const amt = o.openAmt || 0;
        const h = o.h * (1 - amt);
        ctx.fillStyle = rgba('#000', 0.45);
        ctx.fillRect(o.x + 3, o.y, o.w + 2, o.h);
        for (let y = 0; y < h; y += 8) {
          const seg = Math.max(0, Math.min(8, h - y));
          if (seg <= 0) break;
          const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
          g.addColorStop(0, mixHex(pal.wallFace, pal.wall, 0.4));
          g.addColorStop(0.5, pal.wallFace);
          g.addColorStop(1, mixHex(pal.wall, pal.wallFace, 0.3));
          ctx.fillStyle = g;
          ctx.fillRect(o.x, o.y + y, o.w, seg - 1);
          ctx.fillStyle = rgba(pal.trim, 0.35);
          ctx.fillRect(o.x, o.y + y + seg - 1.5, o.w, 1);
        }
        ctx.strokeStyle = rgba(pal.interact, 0.35 + Math.sin(t * 3) * 0.1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(o.x + 0.5, o.y + h - 2);
        ctx.lineTo(o.x + 0.5, o.y + h);
        ctx.moveTo(o.x + o.w - 0.5, o.y + h - 2);
        ctx.lineTo(o.x + o.w - 0.5, o.y + h);
        ctx.stroke();
        ctx.fillStyle = rgba(pal.energy, 0.5 + amt * 0.5);
        ctx.fillRect(o.x, o.y + h - 2, o.w, 2);
        break;
      }
      case 'gate': {
        const amt = o.openAmt || 0;
        const h = o.h * (1 - amt);
        const corrupt = o.corruptSatisfied === false && (o.needCorrupt || 0) > 0;
        const c1 = corrupt ? pal.corrupt : pal.energy;
        ctx.save();
        ctx.globalAlpha = 0.9;
        for (let y = 0; y < h; y += 3) {
          const a = 0.18 + 0.4 * Math.abs(Math.sin((y + t * 90) * 0.05));
          ctx.fillStyle = rgba(c1, a);
          ctx.fillRect(o.x + 1, o.y + y, o.w - 2, 1.6);
        }
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 4);
        ctx.strokeStyle = rgba(c1, 1);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(o.x + 0.75, o.y + 0.75, o.w - 1.5, h);
        ctx.restore();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = rgba(pal.trim, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y - 4);
        ctx.lineTo(o.x + o.w, o.y - 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        const need = o.needEchoes || 0;
        const have = world.echoes ? world.echoes.length : 0;
        if (need > 0) {
          for (let i = 0; i < need; i++) {
            ctx.fillStyle = rgba(have > i ? pal.energy : pal.danger, 0.9);
            ctx.beginPath();
            ctx.arc(o.x + o.w / 2 + (i - (need - 1) / 2) * 7, o.y - 8, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'laser': {
        const o2 = o;
        ctx.fillStyle = rgba(pal.wallFace, 1);
        ctx.fillRect(o2.x - 5, o2.y - 8, 10, 12);
        ctx.fillStyle = rgba(o2.firing ? pal.danger : pal.trim, 0.9);
        ctx.fillRect(o2.x - 3, o2.y - 6, 6, 6);
        if (o2.firing && o2.beam.len > 0) {
          const bx = o2.beam.x;
          const by = o2.beam.y;
          const ex = bx + (o2.beam.dirX || 0) * o2.beam.len;
          const ey = by + (o2.beam.dirY || 0) * o2.beam.len;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = rgba(pal.danger, 0.28);
          ctx.lineWidth = 9;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.strokeStyle = rgba(pal.danger, 0.75);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = 0.5 + Math.sin(t * 20) * 0.2;
          ctx.fillStyle = pal.warn;
          ctx.beginPath();
          ctx.arc(ex, ey, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'platform': {
        const w = o.w;
        const h = o.h;
        ctx.fillStyle = rgba('#000', 0.5);
        ctx.fillRect(o.x + 2, o.y + h - 2, w - 4, 4);
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + h);
        g.addColorStop(0, pal.wallFace);
        g.addColorStop(1, pal.wall);
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, w, h);
        ctx.fillStyle = rgba(pal.energy, 0.9);
        ctx.fillRect(o.x, o.y, w, 2);
        ctx.strokeStyle = rgba(pal.trim, 0.5);
        ctx.lineWidth = 1;
        ctx.strokeRect(o.x + 0.5, o.y + 0.5, w - 1, h - 1);
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 5 + i);
          ctx.fillStyle = pal.energy;
          ctx.fillRect(o.x + 8 + i * ((w - 16) / 2), o.y + h, 10, 2 + Math.sin(t * 8 + i) * 2);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'dampener': {
        if (!o.field) {
          ctx.globalAlpha = 0.35;
        }
        const cx = o.x + o.w / 2;
        const cy = o.y + o.h / 2;
        ctx.strokeStyle = rgba(pal.energy, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.radius, o.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (o.field ? 0.16 : 0.05) + 0.05 * Math.sin(t * 2);
        ctx.fillStyle = pal.energy;
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.radius, o.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(pal.wallFace, 1);
        ctx.fillRect(o.x, o.y - 10, o.w, 10);
        ctx.fillStyle = rgba(o.field ? pal.energy : pal.trim, 0.9);
        ctx.fillRect(o.x + 6, o.y - 8, o.w - 12, 4);
        break;
      }
      case 'core': {
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2 + Math.sin(o.bob) * 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(pal.energy, 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.energy;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'exit': {
        const cx = o.x + o.w / 2;
        const cy = o.y + o.h / 2;
        const a = 0.25 + o.resolved * 0.75;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = pal.energy;
        ctx.beginPath();
        ctx.ellipse(0, 0, 16 + o.resolved * 6, 26 + o.resolved * 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.strokeStyle = pal.interact;
        ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) {
          ctx.save();
          ctx.rotate(o.spin * (i ? -1 : 1));
          ctx.beginPath();
          ctx.arc(0, 0, 14 + i * 5, 0.3, 0.3 + Math.PI * 1.2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      default:
        break;
    }
  }

  drawBoxes(ctx, world, pal) {
    for (const b of world.boxes) {
      if (!b.alive) continue;
      ctx.save();
      if (b.carriedBy) ctx.globalAlpha = 0.9;
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, pal.wallFace);
      g.addColorStop(1, pal.wall);
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = rgba(pal.trim, 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      ctx.strokeStyle = rgba(pal.interact, 0.4);
      ctx.beginPath();
      ctx.moveTo(b.x + 3, b.y + 3);
      ctx.lineTo(b.x + b.w - 3, b.y + b.h - 3);
      ctx.moveTo(b.x + b.w - 3, b.y + 3);
      ctx.lineTo(b.x + 3, b.y + b.h - 3);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.energy, 0.7);
      ctx.fillRect(b.x + 4, b.y + b.h - 4, b.w - 8, 1.5);
      ctx.restore();
    }
  }

  drawPlayer(ctx, world, pal, game) {
    const p = world.player;
    if (!p.alive) {
      this.drawDeathResidue(ctx, p, pal);
      return;
    }
    const alpha = p.invuln > 0 ? 0.45 + 0.55 * Math.abs(Math.sin(this.time * 40)) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawCharacter(ctx, p, {
      body: pal.suit,
      head: pal.player,
      visor: pal.interact,
      orb: p.carrying ? pal.energy : pal.player,
      glow: 1,
    }, game);
    ctx.restore();
    if (p.carrying) {
      // carrying arc: a thin tether between hands and crate
      ctx.strokeStyle = rgba(pal.interact, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.y + 6);
      ctx.lineTo(p.cx + p.facing * 6, p.carrying.cy);
      ctx.stroke();
    }
  }

  drawEchoes(ctx, world, pal, game) {
    for (const e of world.echoes || []) {
      if (!e.alive) continue;
      const sync = clamp(1 - e.divergence, 0, 1);
      const corrupt = e.state === 'corrupted';
      const unstable = e.state === 'unstable' || (e.wasCorrupted && sync < 0.78);
      const faded = e.state === 'done';
      const alpha = (e.opacity ?? 0.6) * (faded ? Math.max(0, 1 - e.fade / 40) * 0.5 : 1);

      // temporal afterimages
      const trail = e.trail;
      if (trail && trail.length) {
        const n = Math.min(trail.length, 10);
        for (let i = 0; i < n; i++) {
          const s = trail[trail.length - 1 - i];
          const f = (1 - i / n) * 0.16 * (0.4 + sync * 0.6);
          ctx.globalAlpha = alpha * f;
          ctx.fillStyle = corruptedColor(pal, i);
          ctx.fillRect(s.x, s.y, 14, 22);
        }
        ctx.globalAlpha = 1;
      }

      ctx.save();
      const jitter = unstable ? (1 - sync) * 3.4 : 0;
      if (jitter > 0.05) {
        ctx.translate(
          Math.sin(this.time * 43 + e.index * 7) * jitter,
          Math.cos(this.time * 37 + e.index * 5) * jitter * 0.6
        );
      }
      const cfg = {
        body: pal.echo,
        head: mixHex(pal.echo, '#ffffff', 0.45),
        visor: pal.interact,
        orb: pal.echo,
        glow: 0.8,
        alpha,
      };
      if (corrupt) {
        // three-channel split: the loudest visual the game has
        ctx.globalAlpha = alpha * 0.5;
        ctx.globalCompositeOperation = 'lighter';
        const sep = 2 + Math.sin(this.time * 22) * 1.5;
        ctx.save();
        ctx.translate(-sep, 0);
        this.drawCharacter(ctx, e, { body: '#ff3b6b', head: '#ff3b6b', visor: '#ff3b6b', glow: 0 }, game);
        ctx.restore();
        ctx.save();
        ctx.translate(sep, 0);
        this.drawCharacter(ctx, e, { body: '#3bffd0', head: '#3bffd0', visor: '#3bffd0', glow: 0 }, game);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = alpha;
      this.drawCharacter(ctx, e, cfg, game);
      // scanline displacement over the silhouette
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = rgba(pal.voidDeep, 0.55);
      const steps = corrupt ? 7 : unstable ? 4 : 2;
      for (let i = 0; i < steps; i++) {
        const yy = e.y + ((i * 7 + Math.floor(this.time * 26 + e.index * 5)) % 22);
        const off = Math.sin(this.time * (30 + i * 4) + i) * (corrupt ? 5 : 2.4);
        ctx.fillRect(e.x + off, yy, 14, 1);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // life arc: how much of its recording is left
      const rec = e.recording;
      const prog = clamp(e.ct / Math.max(1, rec.ticks), 0, 1);
      ctx.globalAlpha = alpha * 0.45;
      ctx.fillStyle = corrupt ? pal.corrupt : pal.echo;
      ctx.fillRect(e.x, e.y - 7, 14 * (1 - prog), 1.5);
      ctx.globalAlpha = 1;
    }
  }

  drawEnemies(ctx, world, pal) {
    for (const g of world.enemies || []) {
      if (g.type === 'guard') this.drawGuard(ctx, g, pal);
      else if (g.type === 'hunter') this.drawHunter(ctx, g, pal);
    }
    for (const s of world.sentinels || []) this.drawSentinel(ctx, s, pal);
  }

  drawGuard(ctx, g, pal) {
    if (!g.alive) return;
    const alert = g.alert || 0;
    const tint = alert > 0.55 ? pal.danger : alert > 0.2 ? pal.warn : pal.trim;
    ctx.save();
    ctx.translate(g.x, g.y);
    if (g.facing < 0) {
      ctx.translate(g.w, 0);
      ctx.scale(-1, 1);
    }
    const bob = Math.sin(this.time * 8 + g.cx * 0.1) * (Math.abs(g.vx) > 0.3 ? 1.2 : 0.3);
    ctx.fillStyle = rgba(pal.wall, 1);
    ctx.fillRect(1, 4 + bob, g.w - 2, g.h - 4);
    ctx.fillStyle = rgba(tint, 0.85);
    ctx.fillRect(1, 4 + bob, g.w - 2, 2);
    ctx.fillStyle = rgba(tint, 0.9);
    ctx.fillRect(4, 9 + bob, g.w - 8, 3);
    ctx.fillStyle = rgba(pal.voidDeep, 1);
    ctx.fillRect(0, g.h - 5, 5, 5);
    ctx.fillRect(g.w - 5, g.h - 5, 5, 5);
    ctx.fillStyle = rgba(tint, 0.5);
    ctx.fillRect(g.w - 2, 6 + bob, 2, 6);
    ctx.restore();
    if (alert > 0.55) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.time * 14);
      ctx.strokeStyle = pal.danger;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.vision * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (alert > 0.2) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pal.warn;
      ctx.font = `10px ${FONT}`;
      ctx.fillText('?', g.cx - 2, g.y - 4);
      ctx.restore();
    }
  }

  drawHunter(ctx, h, pal) {
    if (!h.alive) return;
    const angry = h.angry || 0;
    const c = h.state === 'corrupted' ? pal.corrupt : angry ? pal.danger : pal.corrupt;
    ctx.save();
    ctx.translate(h.cx, h.cy);
    const pulse = 1 + Math.sin(this.time * 6) * 0.08;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = rgba(c, 1);
    ctx.beginPath();
    ctx.ellipse(0, 0, 22 * pulse, 16 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(c, 0.9);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.time * 1.2;
      const r = 10 * pulse;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.75;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(c, 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-5, -0.8, 10, 1.6);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawSentinel(ctx, s, pal) {
    const alert = s.alert || 0;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = rgba(pal.wallFace, 1);
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.trim, 0.9);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = rgba(alert > 0.6 ? pal.danger : pal.interact, 0.5 + alert * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // detection cone
    const a = s.angle || 0;
    ctx.rotate(a);
    const grad = ctx.createLinearGradient(0, 0, s.range, 0);
    grad.addColorStop(0, rgba(alert > 0.6 ? pal.danger : pal.interact, 0.16 + alert * 0.2));
    grad.addColorStop(1, rgba(alert > 0.6 ? pal.danger : pal.interact, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s.range, -s.range * 0.16);
    ctx.lineTo(s.range, s.range * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (s.fire > 0 && s.beamLen > 0) {
      const dx = Math.cos(s.angle);
      const dy = Math.sin(s.angle);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(pal.danger, 0.3);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + dx * s.beamLen, s.y + dy * s.beamLen);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + dx * s.beamLen, s.y + dy * s.beamLen);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCharacter(ctx, body, cfg, game) {
    const x = body.x;
    const y = body.y;
    const w = body.w;
    const h = body.h;
    const moving = Math.abs(body.vx) > 0.5;
    const walk = body.animTick || game.world.tick;
    const swing = moving ? Math.sin(walk * 0.32) : 0;
    const airborne = !body.onGround;
    const bodyColor = cfg.body;
    ctx.save();
    const baseAlpha = ctx.globalAlpha;
    if (cfg.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = baseAlpha * 0.22 * cfg.glow;
      ctx.fillStyle = bodyColor;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = baseAlpha;
    }
    // legs
    ctx.strokeStyle = rgba(bodyColor, 0.95);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const hipY = y + h - 8;
    const legSpread = airborne ? 4 : 0;
    ctx.beginPath();
    ctx.moveTo(x + 4, hipY);
    ctx.lineTo(x + 3 + swing * 4 - legSpread, y + h);
    ctx.moveTo(x + w - 4, hipY);
    ctx.lineTo(x + w - 5 - swing * 4 + legSpread, y + h);
    ctx.stroke();
    // torso
    ctx.fillStyle = rgba(bodyColor, 1);
    ctx.beginPath();
    roundRect(ctx, x + 1, y + 5, w - 2, h - 12, 3);
    ctx.fill();
    ctx.fillStyle = rgba('#000', 0.25);
    ctx.fillRect(x + 1, y + h - 10, w - 2, 2);
    // head
    ctx.fillStyle = rgba(cfg.head || bodyColor, 1);
    ctx.beginPath();
    roundRect(ctx, x + 3, y - 1, w - 6, 8, 2.5);
    ctx.fill();
    // visor
    ctx.fillStyle = rgba(cfg.visor || '#fff', 0.95);
    ctx.fillRect(x + (body.facing > 0 ? w - 7 : 3), y + 1.5, 4, 2);
    // arm reaching when interacting
    ctx.strokeStyle = rgba(bodyColor, 0.9);
    ctx.lineWidth = 2.5;
    const reach = body.interacting || body.carrying ? 7 : 0;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 10);
    ctx.lineTo(x + w / 2 + body.facing * (7 + reach), y + 12 - (swing * 2));
    ctx.stroke();
    ctx.restore();
  }

  drawDeathResidue(ctx, p, pal) {
    const t = clamp(1 - p.deathTick / 60, 0, 1);
    if (t <= 0) return;
    ctx.save();
    ctx.globalAlpha = t * 0.6;
    ctx.fillStyle = pal.danger;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.time;
      ctx.fillRect(p.cx + Math.cos(a) * (1 - t) * 30 - 1, p.cy + Math.sin(a) * (1 - t) * 24 - 1, 2, 2);
    }
    ctx.restore();
  }

  drawEffects(ctx, world, pal, game) {
    // dampener fields
    for (const b of world.behaviors) {
      if (b.kind === 'dampener' && b.o.field) {
        const o = b.o;
        ctx.save();
        ctx.globalAlpha = 0.06 + 0.03 * Math.sin(this.time * 3);
        ctx.fillStyle = pal.energy;
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.radius, o.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    // temporal pull rings around corrupted echoes
    for (const e of world.echoes || []) {
      if (e.state !== 'corrupted' || !e.alive) continue;
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.08 * Math.sin(this.time * 6);
      ctx.strokeStyle = pal.corrupt;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.cx, e.cy, 34 + Math.sin(this.time * 3) * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawScreenFx(ctx, world, pal, W, H, settings, game) {
    if (this.flash.v > 0.01) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, this.flash.v * 0.5);
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const g = world.glitch || 0;
    const shakey = settings.reducedMotion ? 0 : g;
    if (shakey > 0.05) {
      // cheap chromatic tear: displaced colour bars, no canvas feedback
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const slices = 4 + Math.floor(shakey * 7);
      for (let i = 0; i < slices; i++) {
        const y = ((i / slices) * H + this.time * (60 + i * 18)) % H;
        const hh = 2 + ((i * 7) % 10);
        const off = Math.sin(this.time * 30 + i * 2.3) * shakey * 20;
        ctx.globalAlpha = 0.14 * shakey;
        ctx.fillStyle = i % 2 ? pal.corrupt : pal.interact;
        ctx.fillRect(off, y, W * 0.5, hh);
        ctx.globalAlpha = 0.1 * shakey;
        ctx.fillStyle = pal.danger;
        ctx.fillRect(off - 3, y, W * 0.4, hh);
      }
      ctx.restore();
    }
    if (settings.scanlines) {
      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = '#000';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.restore();
    }
    // vignette
    if (!this._vig || this._vig.k !== `${W}x${H}`) {
      const gv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.75);
      gv.addColorStop(0, 'rgba(0,0,0,0)');
      gv.addColorStop(1, 'rgba(0,0,0,0.72)');
      this._vig = { k: `${W}x${H}`, g: gv };
    }
    ctx.save();
    ctx.fillStyle = this._vig.g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawDebug(ctx, game, W, H) {
    const s = game.session;
    const lines = [
      `FPS ${game.fps.toFixed(0)}`,
      `LEVEL ${s.levelDef.id} ${s.levelDef.name}`,
      `TICK ${s.world.tick}  ATTEMPTS ${s.attempts}  DEATHS ${s.deaths}`,
      `ECHOES ${s.echoes.length}  RECORDED ${s.manager.count}/${s.maxEchoes}`,
      `EVENTS ${s.recorder.events.length}  TRACE ${s.recorder.trace.length / 4}`,
      `SYNC ${(s.syncAverage * 100).toFixed(0)}%  DIVERGENCE ${s.echoes.map((e) => `${e.label}:${(e.divergence * 100).toFixed(0)}%`).join(' ')}`,
      `STATE ${s.state}`,
    ];
    ctx.save();
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 330, lines.length * 15 + 10);
    ctx.fillStyle = '#7dffd8';
    lines.forEach((l, i) => ctx.fillText(l, 16, 26 + i * 15));
    ctx.restore();
  }
}

function corruptedColor(pal, i) {
  return i % 3 === 0 ? pal.corrupt : i % 3 === 1 ? rgba(pal.echo, 0.8) : rgba(pal.interact, 0.6);
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

export { Particles };
