import { clamp, lerp } from '../sim/math.js';
import { rgba, mixHex } from '../render/palette.js';
import { formatTicks } from '../app/save.js';

// ---------------------------------------------------------------------------
// UI: immediate-mode overlay. Each frame rebuilds a small list of interactive
// regions; pointer events are hit-tested against the list from the last frame,
// which keeps menus, HUD and pause screens in one place with no retained tree.
// ---------------------------------------------------------------------------

export const FONT = "'Consolas', 'DejaVu Sans Mono', 'SFMono-Regular', monospace";

export class UI {
  constructor() {
    this.regions = [];
    this.focus = 0;
    this.mouse = { x: -999, y: -999 };
    this.hover = null;
    this.w = 960;
    this.h = 540;
    this.dpr = 1;
    this.time = 0;
    this.toast = null;
    this.onAction = () => {};
    this.lastHover = null;
    this.focusBy = {};
    this.scrollY = 0;
    this.flash = {};
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr || 1;
  }

  begin(ctx, dt) {
    this.ctx = ctx;
    this.regions.length = 0;
    this.time += dt || 0;
    this.hover = null;
  }

  // --- primitives ----------------------------------------------------------

  region(id, x, y, w, h, label, opts = {}) {
    const r = { id, x, y, w, h, label, gx: opts.gx ?? 0, gy: opts.gy ?? 0, ...opts };
    r.hot = this.mouse.x >= x && this.mouse.x <= x + w && this.mouse.y >= y && this.mouse.y <= y + h;
    if (r.hot) this.hover = r;
    this.regions.push(r);
    return r;
  }

  text(str, x, y, opts = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${opts.weight || ''} ${opts.size || 13}px ${FONT}`.trim();
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowSize || 10;
    }
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.fillStyle = opts.color || '#cfe9ff';
    if (opts.letterSpacing !== undefined && opts.letterSpacing !== null) {
      const spacing = opts.letterSpacing;
      let total = 0;
      for (let i = 0; i < str.length; i++) total += ctx.measureText(str[i]).width + spacing;
      total -= spacing;
      const align = opts.align || 'left';
      let cx = x;
      if (align === 'center') cx = x - total / 2;
      else if (align === 'right') cx = x - total;
      ctx.textAlign = 'left';
      for (let i = 0; i < str.length; i++) {
        ctx.fillText(str[i], cx, y);
        cx += ctx.measureText(str[i]).width + spacing;
      }
    } else {
      ctx.fillText(str, x, y);
    }
    ctx.restore();
  }

  button(id, x, y, w, h, label, opts = {}) {
    const r = this.region(id, x, y, w, h, label, opts);
    const focused = this.isFocused(r);
    const active = r.hot || focused;
    const ctx = this.ctx;
    const pal = opts.pal;
    const disabled = opts.disabled;
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + (r.gy || 0));
    if (active && !disabled) {
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, rgba(pal.interact, 0.18));
      g.addColorStop(1, rgba(pal.interact, 0.02));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = rgba(pal.interact, 0.9);
      ctx.fillRect(x, y, 2 + pulse * 2, h);
    }
    ctx.strokeStyle = active && !disabled ? rgba(pal.interact, 0.5) : rgba(pal.trim, 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w - 0.5, y);
    ctx.lineTo(x + w - 0.5, y + h);
    ctx.moveTo(x, y + h - 0.5);
    ctx.lineTo(x + w, y + h - 0.5);
    ctx.stroke();
    this.text(label, x + 14, y + h / 2 + 5, {
      size: opts.size || 14,
      color: disabled ? rgba(pal.trim, 0.5) : active ? pal.player : '#9fb4c9',
      letterSpacing: opts.letterSpacing || 2,
      glow: active && !disabled ? rgba(pal.interact, 0.8) : null,
      glowSize: 8,
    });
    if (opts.right) {
      this.text(opts.right, x + w - 14, y + h / 2 + 5, {
        size: 12,
        align: 'right',
        color: disabled ? rgba(pal.trim, 0.45) : rgba(pal.interact, 0.8),
      });
    }
    ctx.restore();
    return r;
  }

  slider(id, x, y, w, label, value, opts = {}) {
    const pal = opts.pal;
    const h = 26;
    const r = this.region(id, x, y - 12, w, h, label, opts);
    const focused = this.isFocused(r);
    const ctx = this.ctx;
    const v = clamp(value, 0, 1);
    ctx.save();
    this.text(label, x, y - 14, { size: 12, color: active2(r, focused) ? pal.player : '#93a7bb', letterSpacing: 1.5 });
    ctx.fillStyle = rgba(pal.trim, 0.25);
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = rgba(active2(r, focused) ? pal.interact : mixHex(pal.trim, pal.interact, 0.5), 0.85);
    ctx.fillRect(x, y, w * v, 4);
    for (let i = 0; i <= 10; i++) {
      ctx.fillStyle = rgba(pal.trim, i % 5 === 0 ? 0.6 : 0.25);
      ctx.fillRect(x + (w * i) / 10 - 0.5, y + 6, 1, i % 5 === 0 ? 6 : 3);
    }
    const hx = x + w * v;
    ctx.fillStyle = active2(r, focused) ? pal.player : pal.interact;
    ctx.fillRect(hx - 2, y - 5, 4, 14);
    ctx.restore();
    return r;
  }

  regionsOrdered() {
    return this.regions;
  }

  prefixOf(id) {
    const i = id.indexOf(':');
    return i < 0 ? id : id.slice(0, i + 1);
  }

  isFocused(r) {
    const pfx = this.prefixOf(r.id);
    const list = this.slice(pfx);
    return list[clamp(this.focusBy[pfx] || 0, 0, list.length - 1)] === r;
  }

  // --- input ---------------------------------------------------------------

  pointerDown(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (r.disabled) return null;
        this.focusBy[this.prefixOf(r.id)] = i;
        this.onAction(r.id, 1);
        return r.id;
      }
    }
    return null;
  }

  pointerMove(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (this.lastHover !== r.id) {
          this.lastHover = r.id;
          if (r.column) this.focus = i;
        }
        return;
      }
    }
    this.lastHover = null;
  }

  focusIndex(id) {
    return this.regions.findIndex((r) => r.id === id);
  }

  slice(prefix) {
    // current screen's regions (used for keyboard navigation)
    return this.regions.filter((r) => r.id.startsWith(prefix));
  }

  moveFocus(prefix, dx, dy) {
    const list = this.slice(prefix);
    if (!list.length) return;
    const idx = this.focusBy[prefix] || 0;
    const cols = Math.max(1, ...list.map((r) => r.gx + 1));
    const rows = Math.max(1, ...list.map((r) => r.gy + 1));
    const cur = list[clamp(idx, 0, list.length - 1)] || list[0];
    let gx = cur.gx + dx;
    let gy = cur.gy + dy;
    if (dx) gx = (gx + cols) % cols;
    if (dy) gy = (gy + rows) % rows;
    let best = null;
    let bestD = Infinity;
    for (const r of list) {
      const d = Math.abs(r.gx - gx) * 2 + Math.abs(r.gy - gy);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best) this.focusBy[prefix] = list.indexOf(best);
  }

  activate(prefix) {
    const list = this.slice(prefix);
    const r = list[clamp(this.focusBy[prefix] || 0, 0, list.length - 1)];
    if (r && !r.disabled) this.onAction(r.id, 1);
    return r;
  }

  // --- utility drawing -----------------------------------------------------

  panel(x, y, w, h, pal) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(3,5,9,0.86)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(pal.trim, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = rgba(pal.interact, 0.6);
    ctx.fillRect(x, y, 3, h);
    ctx.restore();
  }

  bar(x, y, w, v, pal, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = rgba(pal.trim, 0.25);
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = color || pal.interact;
    ctx.fillRect(x, y, w * clamp(v, 0, 1), 4);
    ctx.restore();
  }

  divider(x, y, w, pal, alpha = 0.25) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = rgba(pal.trim, alpha);
    ctx.fillRect(x, y, w, 1);
    ctx.restore();
  }

  // --- main menu -----------------------------------------------------------

  drawMenu(app) {
    const { pal } = app;
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    this.drawMenuScene(app);

    const cx = Math.max(96, W * 0.1);
    const title = 'ECHO//SHIFT';
    const glow = 0.7 + 0.3 * Math.sin(this.time * 1.6);
    const ty = Math.max(120, H * 0.26);
    // three-pass title: shadow, chroma ghost, core
    this.text(title, cx + 3, ty + 2, { size: 52, letterSpacing: 6, color: 'rgba(0,0,0,0.6)' });
    this.text(title, cx - 2 * glow, ty, { size: 52, letterSpacing: 6, color: rgba(pal.corrupt, 0.55) });
    this.text(title, cx + 2 * glow, ty, { size: 52, letterSpacing: 6, color: rgba(pal.echo, 0.55) });
    this.text(title, cx, ty, { size: 52, letterSpacing: 6, color: pal.player, glow: rgba(pal.interact, 0.9), glowSize: 22 });
    this.text('YOUR PAST IS STILL PLAYING.', cx + 2, ty + 26, {
      size: 12,
      letterSpacing: 4,
      color: rgba(pal.interact, 0.85),
    });
    this.divider(cx - 4, ty + 40, Math.min(560, W - cx - 60), pal, 0.35);

    const items = [
      ['menu:continue', 'CONTINUE', app.save.isUnlocked(app.maxUnlocked) && app.save.data.firstRun === false ? `ROOM ${String(app.maxUnlocked).padStart(2, '0')}` : null, !app.hasProgress],
      ['menu:new', 'NEW RUN', null, false],
      ['menu:select', 'LEVEL SELECT', `${Object.keys(app.save.data.completed).length}/15`, false],
      ['menu:settings', 'SETTINGS', null, false],
      ['menu:credits', 'CREDITS', null, false],
      ['menu:quit', 'QUIT', null, false],
    ];
    let y = ty + 76;
    const bw = 320;
    for (const [id, label, right, disabled] of items) {
      this.button(id, cx - 14, y, bw, 34, label, { pal, right, disabled, size: 15, letterSpacing: 3, column: 1 });
      y += 40;
    }

    this.text(`v1.0 · 15 ROOMS · ${app.totalDeaths} DEATHS RECORDED`, 24, H - 20, {
      size: 11,
      color: rgba(pal.trim, 0.85),
      letterSpacing: 1.5,
    });
    this.text('ESC PAUSE  ·  R REWIND  ·  F1 DEBUG', W - 24, H - 20, {
      size: 11,
      align: 'right',
      color: rgba(pal.trim, 0.7),
      letterSpacing: 1.5,
    });
    this.drawSideReadout(app);
  }

  // The menu is alive: drift of past selves behind the panel.
  drawMenuScene(app) {
    const ctx = this.ctx;
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let row = 0; row < 3; row++) {
      const y = H * 0.55 + row * 52;
      ctx.strokeStyle = rgba(pal.trim, 0.18 - row * 0.04);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yy = y + Math.sin((x + this.time * (20 + row * 14)) * 0.006 + row) * 8;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const t = this.time * (0.11 + i * 0.017) + i * 1.7;
      const x = W * 0.62 + Math.sin(t) * 130 + i * 26;
      const y = H * 0.34 + Math.cos(t * 0.8) * 60 + (i % 3) * 54;
      const s = 22 + (i % 3) * 4;
      const a = 0.10 + 0.06 * Math.sin(t * 2 + i);
      ctx.globalAlpha = a;
      ctx.fillStyle = pal.echo;
      ctx.fillRect(x, y, s * 0.62, s * 1.5);
      ctx.fillStyle = pal.player;
      ctx.fillRect(x + s * 0.16, y - s * 0.24, s * 0.3, s * 0.36);
      ctx.globalAlpha = a * 0.6;
      ctx.fillRect(x - 4, y + 6, s * 0.62, 1.5);
    }
    ctx.globalAlpha = 1;
    // slow scanning wipe
    const scan = ((this.time * 0.08) % 1) * H;
    const g = ctx.createLinearGradient(0, scan - 60, 0, scan + 60);
    g.addColorStop(0, rgba(pal.interact, 0));
    g.addColorStop(0.5, rgba(pal.interact, 0.07));
    g.addColorStop(1, rgba(pal.interact, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, scan - 60, W, 120);
    ctx.restore();
  }

  drawSideReadout(app) {
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    if (W < 900) return;
    const x = W - 300;
    const y = Math.max(96, H * 0.3);
    this.panel(x, y, 268, 250, pal);
    this.text('TIMELINE', x + 16, y + 26, { size: 11, letterSpacing: 3, color: rgba(pal.interact, 0.9) });
    this.divider(x + 16, y + 34, 236, pal, 0.3);
    const levels = app.levels || [];
    for (let i = 0; i < 6; i++) {
      const lv = levels[(app.maxUnlocked - 1 + i) % Math.max(1, levels.length)];
      if (!lv) break;
      const done = app.save.data.completed[lv.id];
      const ly = y + 56 + i * 32;
      this.text(`${String(lv.id).padStart(2, '0')}`, x + 16, ly, { size: 12, color: done ? pal.interact : rgba(pal.trim, 0.8) });
      this.text(lv.name, x + 44, ly, { size: 12, letterSpacing: 1.6, color: done ? '#cfe9ff' : rgba(pal.trim, 0.75) });
      if (done) {
        this.text('✓', x + 244, ly, { size: 12, align: 'right', color: pal.energy });
        this.text(formatTicks(done.ticks || 0), x + 210, ly, { size: 10, align: 'right', color: rgba(pal.trim, 0.8) });
      } else {
        this.text(app.save.isUnlocked(lv.id) ? 'OPEN' : 'LOCKED', x + 244, ly, {
          size: 10,
          align: 'right',
          color: app.save.isUnlocked(lv.id) ? rgba(pal.warn, 0.9) : rgba(pal.trim, 0.5),
        });
      }
      this.divider(x + 16, ly + 8, 236, pal, 0.1);
    }
  }

  // --- level select --------------------------------------------------------

  drawLevelSelect(app) {
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    this.text('LEVEL SELECT', 48, 64, { size: 22, letterSpacing: 8, color: pal.player, glow: rgba(pal.interact, 0.8), glowSize: 14 });
    this.text('EVERY ROOM IS A RECORDING OF SOMEONE ELSE SOLVING IT.', 48, 84, {
      size: 11,
      letterSpacing: 2,
      color: rgba(pal.interact, 0.7),
    });
    const cols = 5;
    const tw = Math.min(180, (W - 120) / cols - 16);
    const th = 104;
    for (const lv of app.levels) {
      const i = lv.id - 1;
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const x = 56 + gx * (tw + 18);
      const y = 120 + gy * (th + 18);
      const unlocked = app.save.isUnlocked(lv.id);
      const done = app.save.data.completed[lv.id];
      const id = `select:${lv.id}`;
      const r = this.region(id, x, y, tw, th, lv.name, { pal, gx, gy, column: 1, disabled: !unlocked });
      const focused = this.regions[this.focus] === r;
      ctxCard(this.ctx, x, y, tw, th, pal, { unlocked, done, hot: r.hot || focused });
      this.text(String(lv.id).padStart(2, '0'), x + 12, y + 28, {
        size: 20,
        color: unlocked ? pal.player : rgba(pal.trim, 0.5),
        glow: unlocked ? rgba(pal.interact, 0.6) : null,
      });
      this.text(lv.name, x + 12, y + 52, {
        size: 12,
        letterSpacing: 1.6,
        color: unlocked ? '#cfe9ff' : rgba(pal.trim, 0.45),
      });
      this.text(unlocked ? lv.subtitle || '' : 'LOCKED', x + 12, y + 68, {
        size: 9,
        color: rgba(pal.trim, unlocked ? 0.85 : 0.4),
      });
      if (done) {
        this.bar(x + 12, y + th - 22, tw - 24, 1, pal, pal.energy);
        this.text(`${done.attempts} RUNS · ${formatTicks(done.ticks || 0)}`, x + 12, y + th - 30, {
          size: 9,
          color: rgba(pal.energy, 0.8),
        });
      } else if (unlocked) {
        this.bar(x + 12, y + th - 22, tw - 24, 0.06, pal, pal.warn);
        this.text('UNRESOLVED', x + 12, y + th - 30, { size: 9, color: rgba(pal.warn, 0.8) });
      }
    }
    this.button('select:back', 48, H - 64, 180, 34, 'BACK', { pal, gx: 0, gy: 9, column: 1 });
    this.button('select:menu', 244, H - 64, 180, 34, 'MAIN MENU', { pal, gx: 1, gy: 9, column: 1 });
    this.text('ARROWS SELECT  ·  ENTER OPEN  ·  ESC BACK', W - 48, H - 42, {
      size: 11,
      align: 'right',
      color: rgba(pal.trim, 0.75),
      letterSpacing: 1.5,
    });
  }

  // --- settings ------------------------------------------------------------

  drawSettings(app) {
    const { pal } = app;
    const s = app.save.settings;
    const W = this.w;
    const H = this.h;
    const x = W / 2 - 260;
    this.text('SETTINGS', W / 2, 84, { size: 22, align: 'center', letterSpacing: 10, color: pal.player, glow: rgba(pal.interact, 0.8) });
    this.divider(x, 104, 520, pal, 0.3);

    const sliders = [
      ['set:master', 'MASTER', 'master'],
      ['set:sfx', 'SFX', 'sfx'],
      ['set:music', 'AMBIENCE', 'music'],
    ];
    let y = 150;
    for (const [id, label, key] of sliders) {
      this.slider(id, x, y, 520, label, s[key], { pal, gx: 0, gy: 0 });
      this.text(`${Math.round(s[key] * 100)}%`, x + 520, y + 4, { size: 11, align: 'right', color: rgba(pal.interact, 0.9) });
      y += 52;
    }

    const toggles = [
      ['set:shake', 'SCREEN SHAKE', 'shake'],
      ['set:vfx', 'VISUAL EFFECTS', 'vfx'],
      ['set:motion', 'REDUCED MOTION', 'reducedMotion'],
      ['set:scan', 'SCANLINES', 'scanlines'],
    ];
    y += 6;
    for (const [id, label, key] of toggles) {
      const on = !!s[key];
      this.button(id, x, y, 520, 32, label, {
        pal,
        right: on ? 'ON' : 'OFF',
        size: 13,
        column: 1,
        gx: 0,
        gy: 1,
      });
      y += 38;
    }

    this.button('set:reset', x, y + 8, 250, 34, 'RESET PROGRESS', { pal, size: 12, column: 1, gx: 0, gy: 2 });
    this.button('set:back', x + 270, y + 8, 250, 34, 'BACK', { pal, size: 12, column: 1, gx: 1, gy: 2 });
    this.text('ARROWS ADJUST  ·  ESC BACK', W / 2, H - 34, { size: 11, align: 'center', color: rgba(pal.trim, 0.75), letterSpacing: 2 });
  }

  // --- credits -------------------------------------------------------------

  drawCredits(app) {
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    this.text('CREDITS', W / 2, 96, { size: 22, align: 'center', letterSpacing: 10, color: pal.player, glow: rgba(pal.interact, 0.8) });
    const lines = [
      ['DESIGN · CODE · ART · SOUND', 'one temporal engineer'],
      ['ENGINE', 'deterministic 60Hz simulation, zero assets, canvas2d + procedural web audio'],
      ['ECHO SYSTEM', 'event recording, delta input replay, divergence model'],
      ['LEVELS', '15 hand-authored rooms, each proven solvable headlessly'],
      ['PLAYTESTING', 'the harness in tests/headless.js plays the game for you'],
      ['SPECIAL THANKS', 'everyone who rewound one more time'],
    ];
    let y = 150;
    for (const [k, v] of lines) {
      this.text(k, W / 2, y, { size: 11, align: 'center', letterSpacing: 4, color: rgba(pal.interact, 0.9) });
      this.text(v, W / 2, y + 18, { size: 12, align: 'center', color: '#cfe9ff' });
      y += 52;
    }
    this.button('credits:back', W / 2 - 100, H - 76, 200, 36, 'BACK', { pal, column: 1 });
    this.text('THE ROOM REMEMBERS YOU.', W / 2, H - 26, { size: 10, align: 'center', color: rgba(pal.trim, 0.8), letterSpacing: 3 });
  }

  // --- pause / complete ----------------------------------------------------

  drawPause(app) {
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2,4,8,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    const x = W / 2 - 170;
    const y = H / 2 - 150;
    this.panel(x, y, 340, 300, pal);
    this.text('PAUSED', W / 2, y + 46, { size: 20, align: 'center', letterSpacing: 8, color: pal.player, glow: rgba(pal.interact, 0.8) });
    this.text(`ROOM ${String(app.session.levelDef.id).padStart(2, '0')} · ${app.session.levelDef.name}`, W / 2, y + 68, {
      size: 11,
      align: 'center',
      color: rgba(pal.interact, 0.8),
      letterSpacing: 2,
    });
    let by = y + 92;
    const items = [
      ['pause:resume', 'RESUME'],
      ['pause:restart', 'REWIND ROOM'],
      ['pause:settings', 'SETTINGS'],
      ['pause:select', 'LEVEL SELECT'],
      ['pause:menu', 'MAIN MENU'],
    ];
    for (const [id, label] of items) {
      this.button(id, x + 20, by, 300, 32, label, { pal, size: 13, column: 1 });
      by += 38;
    }
  }

  drawComplete(app) {
    const { pal } = app;
    const W = this.w;
    const H = this.h;
    const ctx = this.ctx;
    const t = clamp(app.completeT, 0, 1);
    ctx.save();
    ctx.fillStyle = `rgba(2,4,8,${0.4 + t * 0.42})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    const c = app.session.completion || { attempts: 1, ticks: 0, deaths: 0, echoes: 0 };
    const x = W / 2 - 220;
    const y = H / 2 - 140;
    this.panel(x, y, 440, 260, pal);
    this.text('ROOM RESOLVED', W / 2, y + 48, { size: 22, align: 'center', letterSpacing: 8, color: pal.energy, glow: rgba(pal.energy, 0.8) });
    this.text(app.session.levelDef.name, W / 2, y + 72, { size: 12, align: 'center', letterSpacing: 3, color: '#cfe9ff' });
    const rows = [
      ['RUNS', String(c.attempts)],
      ['ECHOES LOST / KEPT', `${c.deaths} / ${c.echoes}`],
      ['ROOM TIME', formatTicks(c.ticks)],
      ['PAR', `<= ${app.session.level.par}`],
    ];
    let ry = y + 100;
    for (const [k, v] of rows) {
      this.text(k, x + 28, ry, { size: 11, color: rgba(pal.trim, 0.9), letterSpacing: 2 });
      this.text(v, x + 412, ry, { size: 12, align: 'right', color: pal.player });
      this.divider(x + 28, ry + 8, 384, pal, 0.15);
      ry += 30;
    }
    const parMet = c.attempts <= app.session.level.par;
    this.text(parMet ? 'OPTIMAL TIMELINE' : 'THE ECHO CHAIN HOLDS', x + 28, ry + 4, {
      size: 11,
      color: parMet ? pal.energy : pal.warn,
      letterSpacing: 2,
    });
    const isLast = app.session.levelDef.id >= app.levels.length;
    this.button('done:next', x + 20, y + 208, isLast ? 400 : 190, 34, isLast ? 'RETURN TO MENU' : 'NEXT ROOM', {
      pal,
      size: 13,
      column: 1,
      gx: 0,
      gy: 1,
    });
    if (!isLast) {
      this.button('done:retry', x + 220, y + 208, 96, 34, 'RETRY', { pal, size: 13, column: 1, gx: 1, gy: 1 });
      this.button('done:menu', x + 326, y + 208, 100, 34, 'MENU', { pal, size: 13, column: 1, gx: 2, gy: 1 });
    }
  }

  // --- in-game HUD ---------------------------------------------------------

  drawHUD(app) {
    const { pal, session } = app;
    const W = this.w;
    const H = this.h;
    const lv = session.levelDef;
    const ctx = this.ctx;
    const w = session.world;

    // room plate
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,10,0.55)';
    ctx.fillRect(18, 16, 292, 62);
    ctx.fillStyle = rgba(pal.interact, 0.75);
    ctx.fillRect(18, 16, 2, 62);
    ctx.restore();
    this.text(`ROOM ${String(lv.id).padStart(2, '0')} // ${lv.name}`, 32, 38, {
      size: 15,
      letterSpacing: 3,
      color: pal.player,
      glow: rgba(pal.interact, 0.5),
    });
    this.text((lv.subtitle || '').toUpperCase(), 32, 56, {
      size: 10,
      letterSpacing: 2.5,
      color: rgba(pal.interact, 0.85),
    });
    this.text(lv.hint || '', 32, 71, { size: 10, letterSpacing: 1.4, color: rgba(pal.warn, 0.85), alpha: 0.95 });

    // session readout
    const rx = W - 250;
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,10,0.5)';
    ctx.fillRect(rx, 16, 232, 62);
    ctx.restore();
    this.text(`RUNS ${session.attempts}`, rx + 14, 38, { size: 11, letterSpacing: 2, color: '#cfe9ff' });
    this.text(`ECHOES ${w.echoes.length}/${session.maxEchoes}`, rx + 118, 38, { size: 11, letterSpacing: 2, color: '#cfe9ff' });
    const sync = session.syncAverage;
    this.text('TIMELINE COHERENCE', rx + 14, 54, { size: 9, letterSpacing: 2, color: rgba(pal.trim, 0.9) });
    this.bar(rx + 14, 60, 204, sync, pal, sync > 0.78 ? pal.energy : sync > 0.5 ? pal.warn : pal.danger);
    this.text(`${Math.round(sync * 100)}%`, rx + 204, 78, { size: 10, align: 'right', color: rgba(pal.interact, 0.9) });

    this.drawTimeline(app, 24, H - 86);
    this.drawControls(app, W - 24, H - 66);
    this.drawPrompts(app);
    if (this.toast) this.drawToast(app);
  }

  // The timeline is the heart of the interface: every past attempt is a bar
  // running under the present one.
  drawTimeline(app, x, y) {
    const { pal, session } = app;
    const ctx = this.ctx;
    const w = session.world;
    const rows = session.timeline();
    const width = Math.min(420, this.w * 0.42);
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,10,0.55)';
    ctx.fillRect(x - 8, y - 18, width + 16, 56 + rows.length * 20 + 24);
    ctx.strokeStyle = rgba(pal.trim, 0.25);
    ctx.strokeRect(x - 7.5, y - 17.5, width + 15, 56 + rows.length * 20 + 24);
    ctx.restore();
    this.text('TIMELINE', x, y - 4, { size: 10, letterSpacing: 3, color: rgba(pal.interact, 0.9) });

    let ry = y + 14;
    // current attempt first: it is the branch you are writing right now
    const curTicks = w.tick;
    const scale = Math.max(120, Math.max(curTicks, ...rows.map((r) => r.ticks || 0), 600));
    this.text('CURRENT', x, ry + 9, { size: 10, letterSpacing: 2, color: pal.player });
    ctx.save();
    ctx.strokeStyle = rgba(pal.interact, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 70, ry + 5);
    ctx.lineTo(x + 70 + (width - 96) * clamp(curTicks / scale, 0, 1), ry + 5);
    ctx.stroke();
    ctx.fillStyle = pal.player;
    ctx.beginPath();
    ctx.arc(x + 70 + (width - 96) * clamp(curTicks / scale, 0, 1), ry + 5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ry += 22;

    for (const r of rows) {
      const echo = w.echoes.find((e) => e.label === r.label);
      const sync = echo ? Math.max(0, 1 - echo.divergence) : 1;
      const col = !r.alive && r.state === 'despawned' ? rgba(pal.trim, 0.5) : sync > 0.78 ? pal.echo : sync > 0.5 ? pal.warn : pal.danger;
      this.text(`ECHO 0${r.label}`, x, ry + 9, { size: 10, letterSpacing: 2, color: rgba(pal.echo, r.alive ? 0.95 : 0.5) });
      const bl = width - 96;
      // full recorded length as a ghost track
      ctx.save();
      ctx.fillStyle = rgba(pal.trim, 0.18);
      ctx.fillRect(x + 70, ry + 4, bl * clamp((r.ticks || 0) / scale, 0, 1), 2);
      ctx.fillStyle = col;
      const prog = r.alive ? clamp(r.progress, 0, 1) : 1;
      ctx.fillRect(x + 70, ry + 4, bl * clamp((r.ticks || 0) / scale, 0, 1) * prog, 2);
      if (r.endedInDeath) {
        ctx.fillStyle = rgba(pal.danger, 0.9);
        ctx.fillRect(x + 70 + bl * clamp((r.ticks || 0) / scale, 0, 1) - 1, ry + 1, 2, 8);
      }
      ctx.restore();
      if (r.alive) {
        this.text(`${Math.round(sync * 100)}%`, x + width, ry + 9, {
          size: 9,
          align: 'right',
          color: col,
        });
        if (echo && echo.state !== 'active') {
          this.text(echo.state.toUpperCase(), x + width - 34, ry + 9, {
            size: 8,
            align: 'right',
            color: echo.state === 'corrupted' ? pal.corrupt : pal.warn,
          });
        }
      } else {
        this.text(r.state === 'despawned' ? 'CLOSED' : 'ENDED', x + width, ry + 9, {
          size: 9,
          align: 'right',
          color: rgba(pal.trim, 0.6),
        });
      }
      ry += 20;
    }
    if (!rows.length) {
      this.text('NO PAST ATTEMPTS YET', x + 70, ry + 9, { size: 9, color: rgba(pal.trim, 0.7), letterSpacing: 1.5 });
    }
  }

  drawControls(app, x, y) {
    const { pal } = app;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = rgba(pal.trim, 0.9);
    ctx.textAlign = 'right';
    const lines = ['A D MOVE   W JUMP   SHIFT SPRINT', 'E INTERACT   G LIFT / DROP', 'R REWIND THE ROOM   ESC PAUSE'];
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * 14));
    ctx.restore();
  }

  // Floating teaching prompts anchored to room coordinates.
  drawPrompts(app) {
    const { pal, session, camera, dt } = app;
    const lv = session.levelDef;
    if (!lv.prompts || !lv.prompts.length) return;
    const W = this.w;
    const H = this.h;
    const ctx = this.ctx;
    const hasEcho = session.echoes.length > 0;
    for (const p of lv.prompts) {
      if (p.when === 'after-echo' && !hasEcho) continue;
      if (p.when === 'before-echo' && hasEcho) continue;
      const start = (p.delay || 0) / 60;
      const age = session.world.tick / 60 - start;
      if (age < 0) continue;
      const a = clamp(age / 0.6, 0, 1) * clamp((age - 6) < 0 ? 1 : 1, 0, 1);
      if (a <= 0) continue;
      const s = camera.worldToScreen(p.x * 24 + 12, p.y * 24 + 12, W, H);
      const bob = Math.sin(this.time * 2 + p.x) * 2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `11px ${FONT}`;
      const tw = ctx.measureText(p.text).width;
      ctx.fillStyle = 'rgba(3,6,10,0.7)';
      ctx.fillRect(s.x - tw / 2 - 8, s.y - 24 + bob, tw + 16, 20);
      ctx.strokeStyle = rgba(pal.interact, 0.5);
      ctx.strokeRect(s.x - tw / 2 - 7.5, s.y - 23.5 + bob, tw + 15, 19);
      ctx.fillStyle = pal.player;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, s.x, s.y - 10 + bob);
      // leader line to the thing being described
      ctx.strokeStyle = rgba(pal.interact, 0.4);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 4 + bob);
      ctx.lineTo(s.x, s.y + 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawToast(app) {
    const { pal } = app;
    const t = this.toast;
    const a = clamp(t.life, 0, 1);
    const W = this.w;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `12px ${FONT}`;
    const tw = ctx.measureText(t.text).width;
    ctx.fillStyle = 'rgba(3,6,10,0.8)';
    ctx.fillRect(W / 2 - tw / 2 - 14, this.h * 0.76, tw + 28, 26);
    ctx.strokeStyle = rgba(t.color || pal.interact, 0.7);
    ctx.strokeRect(W / 2 - tw / 2 - 13.5, this.h * 0.76 + 0.5, tw + 27, 25);
    ctx.fillStyle = t.color || pal.player;
    ctx.textAlign = 'center';
    ctx.fillText(t.text, W / 2, this.h * 0.76 + 17);
    ctx.restore();
  }

  say(text, color) {
    this.toast = { text, color, life: 1 };
  }

  updateToast(dt) {
    if (!this.toast) return;
    this.toast.life -= dt * 0.5;
    if (this.toast.life <= 0) this.toast = null;
  }
}

function ctxCard(ctx, x, y, w, h, pal, opts) {
  ctx.save();
  ctx.fillStyle = opts.hot ? 'rgba(12,20,30,0.95)' : 'rgba(6,10,16,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(opts.hot ? pal.interact : pal.trim, opts.hot ? 0.8 : 0.3);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (opts.done) {
    ctx.fillStyle = rgba(pal.energy, 0.5);
    ctx.fillRect(x, y, 3, h);
  } else if (opts.hot) {
    ctx.fillStyle = rgba(pal.interact, 0.6);
    ctx.fillRect(x, y, 3, h);
  }
  if (!opts.unlocked) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function active2(r, focused) {
  return r.hot || focused;
}

export { lerp, formatTicks };
