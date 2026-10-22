import { LEVELS, LEVEL_COUNT } from './levels/index.js';
import { Session, STATE, DEATH_HOLD_TICKS } from './app/session.js';
import { Save, formatTicks } from './app/save.js';
import { BTN } from './sim/input.js';
import { Renderer } from './render/renderer.js';
import { Camera } from './render/camera.js';
import { paletteFor } from './render/palette.js';
import { UI, FONT } from './ui/ui.js';
import { Audio } from './audio/audio.js';

// ---------------------------------------------------------------------------
// ECHO//SHIFT application shell. Owns the scene machine, the fixed-timestep
// loop, input, audio feedback and screen transitions. Every simulation tick
// goes through Session.step, the same call the headless harness uses.
// ---------------------------------------------------------------------------

const SCENE = {
  MENU: 'menu',
  SELECT: 'select',
  SETTINGS: 'settings',
  CREDITS: 'credits',
  GAME: 'game',
};

const KEYMAP = {
  ArrowLeft: BTN.LEFT,
  KeyA: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  KeyD: BTN.RIGHT,
  ArrowUp: BTN.UP,
  KeyW: BTN.UP,
  ArrowDown: BTN.DOWN,
  KeyS: BTN.DOWN,
  KeyZ: BTN.JUMP,
  Space: BTN.JUMP,
  ShiftLeft: BTN.SPRINT,
  ShiftRight: BTN.SPRINT,
  KeyE: BTN.INTERACT,
  KeyG: BTN.GRAB,
};

const MENU_KEYMAP = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Enter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

class App {
  constructor() {
    this.save = new Save();
    this.audio = new Audio();
    this.scene = SCENE.MENU;
    this.sub = null; // sub-menu stack (settings opened from pause)
    this.levels = LEVELS;
    this.maxUnlocked = this.save.data.unlocked || 1;
    this.hasProgress = this.save.data.firstRun === false;
    this.totalDeaths = 0;
    this.session = null;
    this.pal = paletteFor(0);
    this.paused = false;
    this.debug = false;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.transition = null;
    this.completeT = 0;
    this.deathHold = 0;
    this.held = 0;
    this.prevHeld = 0;
    this.pendingAction = null;
    this.introT = 0;
    this.menuFocusBack = null;
    this.settingsFrom = SCENE.MENU;
    this.flashFx = { v: 0, color: '#ffffff' };

    const canvas = document.getElementById('game');
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.camera = new Camera();
    this.ui = new UI();
    this.ui.onAction = (id, v) => this.onAction(id, v);
    this.pal = paletteFor(0);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.scene === SCENE.GAME && !this.paused) this.setPaused(true);
    });
    for (const key of ['master', 'sfx', 'music']) this.audio.volumes[key] = this.save.settings[key];
    this.applyAudioVolumes();
    this.last = performance.now();
    this.acc = 0;
  }

  // --- lifecycle -----------------------------------------------------------

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.renderer.resize(w, h, dpr);
    this.ui.resize(w, h, dpr);
    if (this.session) this.camera.setViewport(w, h, this.session.level, 1);
  }

  applyAudioVolumes() {
    this.audio.setVolumes({
      master: this.save.settings.master,
      sfx: this.save.settings.sfx,
      music: this.save.settings.music,
    });
  }

  // --- input ---------------------------------------------------------------

  bindInput() {
    const canvas = this.canvas;
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      this.ui.pointerMove(e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener('pointermove', (e) => {
      toCanvas(e);
      if (this.ui.hover && this.ui.hover.id !== this._lastHoverId) {
        this._lastHoverId = this.ui.hover.id;
        this.audio.unlock();
        this.audio.play('ui_move', { vol: 0.7 });
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      toCanvas(e);
      this.ui.pointerDown(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => {
      this.held = 0;
      this.prevHeld = 0;
    });
  }

  onKeyDown(e) {
    if (e.repeat) return;
    this.audio.unlock();
    const code = e.code;
    if (code === 'F1') {
      e.preventDefault();
      this.debug = !this.debug;
      return;
    }
    if (code === 'F11') return; // let the browser handle fullscreen
    const inGame = this.scene === SCENE.GAME;
    const simActive = inGame && !this.paused && this.completeT <= 0.55;
    if (simActive && KEYMAP[code] !== undefined) {
      e.preventDefault();
      this.held |= KEYMAP[code];
      return;
    }
    if (code === 'KeyR') {
      e.preventDefault();
      this.rewind();
      return;
    }
    if (code === 'Escape') {
      e.preventDefault();
      this.handleEscape();
      return;
    }
    if (!simActive) {
      const a = MENU_KEYMAP[code];
      if (a) {
        e.preventDefault();
        this.menuKey(a);
      }
    }
  }

  onKeyUp(e) {
    const bit = KEYMAP[e.code];
    if (bit !== undefined) this.held &= ~bit;
  }

  menuKey(a) {
    const ui = this.ui;
    const prefix = this.focusPrefix();
    if (!prefix) return;
    if (a === 'up') ui.moveFocus(prefix, 0, -1);
    else if (a === 'down') ui.moveFocus(prefix, 0, 1);
    else if (a === 'left') ui.moveFocus(prefix, -1, 0);
    else if (a === 'right') ui.moveFocus(prefix, 1, 0);
    else if (a === 'confirm') ui.activate(prefix);
    else if (a === 'back') this.handleEscape();
    this.audio.play('ui_move', { vol: 0.6 });
  }

  focusPrefix() {
    switch (this.scene) {
      case SCENE.MENU:
        return 'menu:';
      case SCENE.SELECT:
        return 'select:';
      case SCENE.SETTINGS:
        return 'set:';
      case SCENE.CREDITS:
        return 'credits:';
      case SCENE.GAME:
        if (this.paused) return 'pause:';
        if (this.completeT > 0.55) return 'done:';
        return null;
      default:
        return null;
    }
  }

  handleEscape() {
    if (this.scene === SCENE.GAME) {
      if (this.completeT > 0.55) return;
      this.setPaused(!this.paused);
      return;
    }
    if (this.scene === SCENE.SETTINGS) {
      this.scene = this.settingsFrom;
      this.ui.focusBy = {};
      this.audio.play('ui_back');
      return;
    }
    if (this.scene !== SCENE.MENU) {
      this.scene = SCENE.MENU;
      this.ui.focusBy = {};
      this.audio.play('ui_back');
    }
  }

  setPaused(v) {
    this.paused = v;
    this.ui.focusBy = {};
    this.audio.play(v ? 'ui_back' : 'ui_click');
    if (v) this.audio.updateTension(0.05);
  }

  // --- actions -------------------------------------------------------------

  onAction(id, v) {
    if (!id) return;
    this.audio.unlock();
    const [head] = id.split(':');
    if (head === 'menu') this.menuAction(id);
    else if (head === 'select') this.selectAction(id);
    else if (head === 'set') this.settingsAction(id);
    else if (head === 'credits') {
      this.scene = SCENE.MENU;
      this.ui.focusBy = {};
      this.audio.play('ui_back');
    } else if (head === 'pause') this.pauseAction(id);
    else if (head === 'done') this.doneAction(id);
    void v;
  }

  menuAction(id) {
    this.audio.play('ui_click');
    switch (id) {
      case 'menu:continue':
        this.startLevel(this.save.data.firstRun ? 1 : this.maxUnlocked);
        break;
      case 'menu:new':
        this.save.resetProgress();
        this.maxUnlocked = 1;
        this.hasProgress = false;
        this.startLevel(1);
        break;
      case 'menu:select':
        this.scene = SCENE.SELECT;
        this.ui.focusBy = {};
        break;
      case 'menu:settings':
        this.settingsFrom = SCENE.MENU;
        this.scene = SCENE.SETTINGS;
        this.ui.focusBy = {};
        break;
      case 'menu:credits':
        this.scene = SCENE.CREDITS;
        this.ui.focusBy = {};
        break;
      case 'menu:quit':
        this.scene = SCENE.MENU;
        this.ui.say('THERE IS NO QUIT IN A TIME LOOP', '#ffb347');
        break;
      default:
        break;
    }
  }

  selectAction(id) {
    if (id === 'select:back' || id === 'select:menu') {
      this.audio.play('ui_back');
      this.scene = SCENE.MENU;
      this.ui.focusBy = {};
      return;
    }
    const n = Number(id.split(':')[1]);
    if (this.save.isUnlocked(n)) {
      this.audio.play('ui_click');
      this.startLevel(n);
    } else {
      this.audio.play('ui_back');
      this.ui.say('THAT ROOM HAS NOT BEEN REACHED', '#ff5a4d');
    }
  }

  settingsAction(id) {
    const s = this.save.settings;
    const set = (k, val) => {
      this.save.setSetting(k, val);
      this.applyAudioVolumes();
    };
    switch (id) {
      case 'set:master':
      case 'set:sfx':
      case 'set:music': {
        const key = id.split(':')[1];
        const rect = this.ui.regions.find((r) => r.id === id);
        if (rect) {
          const x = this.ui.mouse.x;
          set(key, Math.max(0, Math.min(1, (x - rect.x) / rect.w)));
          this.audio.play('ui_move', { vol: 0.8 });
        }
        break;
      }
      case 'set:shake':
        set('shake', !s.shake);
        this.audio.play('ui_click');
        break;
      case 'set:vfx':
        set('vfx', !s.vfx);
        this.audio.play('ui_click');
        break;
      case 'set:motion':
        set('reducedMotion', !s.reducedMotion);
        this.audio.play('ui_click');
        break;
      case 'set:scan':
        set('scanlines', !s.scanlines);
        this.audio.play('ui_click');
        break;
      case 'set:reset':
        this.save.resetProgress();
        this.maxUnlocked = 1;
        this.ui.focusBy = {};
        this.audio.play('ui_back');
        this.ui.say('PROGRESS RESET', '#ff5a4d');
        break;
      case 'set:back':
        this.scene = this.settingsFrom;
        this.ui.focusBy = {};
        this.audio.play('ui_back');
        break;
      default:
        break;
    }
  }

  pauseAction(id) {
    this.audio.play('ui_click');
    switch (id) {
      case 'pause:resume':
        this.setPaused(false);
        break;
      case 'pause:restart':
        this.setPaused(false);
        this.rewind(true);
        break;
      case 'pause:settings':
        this.settingsFrom = SCENE.GAME;
        this.scene = SCENE.SETTINGS;
        this.ui.focusBy = {};
        break;
      case 'pause:select':
        this.setPaused(false);
        this.leaveGame(SCENE.SELECT);
        break;
      case 'pause:menu':
        this.setPaused(false);
        this.leaveGame(SCENE.MENU);
        break;
      default:
        break;
    }
  }

  doneAction(id) {
    this.audio.play('ui_click');
    const next = this.session.levelDef.id + 1;
    switch (id) {
      case 'done:next':
        if (next > LEVEL_COUNT) this.leaveGame(SCENE.MENU);
        else this.startLevel(next);
        break;
      case 'done:retry':
        this.startLevel(this.session.levelDef.id);
        break;
      case 'done:menu':
        this.leaveGame(SCENE.MENU);
        break;
      default:
        break;
    }
  }

  // --- scene transitions ---------------------------------------------------

  startLevel(id) {
    const first = !this.session || this.session.levelDef.id !== id;
    this.session = new Session(id);
    this.pal = paletteFor(this.session.levelDef.palette || 0);
    this.scene = SCENE.GAME;
    this.paused = false;
    this.completeT = 0;
    this.deathHold = 0;
    this.held = 0;
    this.prevHeld = 0;
    this.ui.focusBy = {};
    this.camera.setViewport(this.w, this.h, this.session.level, 1);
    this.camera.snap(this.session.level, this.session.world.player);
    this.transition = { kind: first ? 'enter' : 'enter', t: 0, dur: first ? 0.9 : 0.75 };
    this.renderer.particles.clear();
    this.bindWorldEvents();
    this.audio.startAmbient(this.session.levelDef.palette || 0, id);
    this.audio.play('rewind');
    this.ui.say(`ROOM ${String(id).padStart(2, '0')} · ${this.session.levelDef.name}`, this.pal.interact);
  }

  leaveGame(scene) {
    this.session = null;
    this.scene = scene;
    this.ui.focusBy = {};
    this.audio.stopAmbient();
    this.renderer.particles.clear();
  }

  rewind(fromMenu = false) {
    if (!this.session || this.scene !== SCENE.GAME) return;
    if (this.session.state === STATE.COMPLETE) return;
    if (fromMenu) this.paused = false;
    const rec = this.session.restart('manual');
    this.transition = { kind: 'rewind', t: 0, dur: 0.5 };
    this.renderer.particles.clear();
    this.bindWorldEvents();
    this.audio.play('rewind');
    this.flashFx = { v: 1, color: this.pal.corrupt };
    const n = rec ? this.session.echoes.length : this.session.echoes.length;
    this.ui.say(n > 0 ? `REWOUND · ${n} ECHO${n === 1 ? '' : 'ES'} ACTIVE` : 'REWOUND', this.pal.echo);
  }

  bindWorldEvents() {
    const w = this.session.world;
    w.onEvent = (ev) => this.onWorldEvent(ev);
  }

  // --- feedback ------------------------------------------------------------

  onWorldEvent(ev) {
    const pal = this.pal;
    const parts = this.renderer.particles;
    const target = ev.target ? String(ev.target) : '';
    const fromEcho = target.startsWith('echo');
    const opt = { echo: fromEcho };
    const x = ev.x;
    const y = ev.y;
    switch (ev.type) {
      case 'PLATE_DOWN':
        this.audio.play('plate', opt);
        parts.dust(x, y, pal.interact, 5, 26);
        break;
      case 'PLATE_UP':
        this.audio.play('plate_up', opt);
        break;
      case 'BUTTON_PRESS':
        this.audio.play('button', opt);
        parts.sparks(x, y, pal.interact, 5, 50);
        break;
      case 'SWITCH':
        this.audio.play('switch', opt);
        break;
      case 'RELAY':
        this.audio.play('relay', opt);
        parts.ring(x, y, pal.energy, 18, 0.4);
        break;
      case 'DOOR':
        this.audio.play('door', { echo: fromEcho, vol: 1 });
        this.camera.addShake(0.16);
        parts.dust(x, y, pal.trim, 6, 34);
        break;
      case 'EXIT_OPEN':
        this.audio.play('gate');
        parts.ring(x, y, pal.energy, 30, 0.6);
        break;
      case 'JUMP':
        this.audio.play('jump', opt);
        break;
      case 'LAND':
        this.audio.play('land', opt);
        parts.dust(x, y + 10, pal.trim, 3, 22);
        break;
      case 'DAMAGE':
        this.audio.play('hurt');
        parts.sparks(x, y, pal.danger, 8, 90);
        this.camera.addShake(0.4);
        break;
      case 'DEATH':
        this.audio.play('death');
        parts.echoDeath(x, y, pal.danger);
        this.camera.addShake(1.1);
        this.flashFx = { v: 1, color: pal.danger };
        break;
      case 'ECHO_LOST':
        this.audio.play('echo_death');
        parts.echoDeath(x, y, pal.echo);
        this.camera.addShake(0.5);
        this.flashFx = { v: 0.8, color: pal.echo };
        break;
      case 'ECHO_CORRUPT':
        this.audio.play('echo_corrupt');
        parts.corrupt(x, y, pal.corrupt);
        this.camera.addShake(0.55);
        this.flashFx = { v: 0.7, color: pal.corrupt };
        break;
      case 'ECHO_UNSTABLE':
        parts.corrupt(x, y, pal.echo);
        break;
      case 'LEVEL_COMPLETE':
        this.audio.play('complete');
        parts.glyph(x, y, pal.energy);
        parts.ring(x, y, pal.energy, 40, 0.8);
        this.camera.addShake(0.4);
        this.flashFx = { v: 1, color: pal.energy };
        break;
      case 'SENTINEL_FIRE':
        this.audio.play('laser');
        this.camera.addShake(0.28);
        break;
      case 'ALERT':
        this.audio.play('alert');
        this.camera.addShake(0.2);
        break;
      case 'PICKUP':
      case 'DROP':
        this.audio.play('switch', opt);
        break;
      case 'INTERACT_MISS':
      case 'GRAB_MISS':
        this.audio.play('ui_back', opt);
        break;
      default:
        break;
    }
  }

  spawnForFlash(f, parts) {
    const pal = this.pal;
    switch (f.kind) {
      case 'player_death':
        parts.echoDeath(f.x, f.y, pal.danger);
        parts.sparks(f.x, f.y, pal.player, 10, 110);
        break;
      case 'echo_death':
        parts.echoDeath(f.x, f.y, pal.echo);
        break;
      case 'echo_despawn':
        parts.dust(f.x, f.y, pal.echo, 8, 40);
        break;
      case 'complete':
        parts.glyph(f.x, f.y, pal.energy);
        break;
      case 'damage':
        parts.sparks(f.x, f.y, pal.danger, 7, 90);
        break;
      case 'box_lost':
        parts.echoDeath(f.x, f.y, pal.trim);
        break;
      case 'temporal_snap':
      case 'glitch':
        parts.corrupt(f.x, f.y, pal.corrupt);
        break;
      case 'box_impact':
        parts.dust(f.x, f.y, pal.trim, 4, 26);
        break;
      default:
        parts.ring(f.x, f.y, pal.interact, 14, 0.3);
    }
  }

  // --- fixed timestep ------------------------------------------------------

  stepGame() {
    const s = this.session;
    if (!s) return;
    if (s.state === STATE.COMPLETE) return;
    const held = this.held;
    const pressed = held & ~this.prevHeld;
    this.prevHeld = held;
    s.step({ held, pressed });

    const w = s.world;
    // effects published by the world are consumed immediately
    if (w.flashes && w.flashes.length) {
      for (const f of w.flashes) this.spawnForFlash(f, this.renderer.particles);
      w.flashes.length = 0;
    }
    if (this.save.settings.shake && w.shake > 0.05) this.camera.addShake(w.shake * 0.4);
    this.audio.bodyNoise(w, w.player, false);
    this.audio.updateTension(Math.min(1, (w.glitch || 0) * 0.6 + (s.syncAverage < 0.78 ? 0.35 : 0.1)));

    if (s.state === STATE.COMPLETE) {
      const c = s.completion;
      this.save.complete(s.levelDef.id, {
        attempts: c.attempts,
        ticks: c.ticks,
        deaths: c.deaths,
        echoes: c.echoes,
      });
      this.maxUnlocked = this.save.data.unlocked;
      this.hasProgress = true;
      if (s.levelDef.id === LEVEL_COUNT) this.audio.play('unlock');
      this.completeT = 0.0001;
      this.ui.focusBy = {};
      return;
    }
    if (s.state === STATE.DEAD) {
      this.deathHold++;
      if (this.deathHold > DEATH_HOLD_TICKS) {
        s.restart('death');
        this.deathHold = 0;
        this.renderer.particles.clear();
        this.bindWorldEvents();
        this.transition = { kind: 'rewind', t: 0, dur: 0.45 };
        this.ui.say('REPLAYING YOUR PAST', this.pal.echo);
      }
    }
  }

  update(dt) {
    this.ui.updateToast(dt);
    if (this.transition) {
      this.transition.t += dt;
      if (this.transition.t >= this.transition.dur) this.transition = null;
    }
    this.flashFx.v = Math.max(0, this.flashFx.v - dt * 2.2);
    this.renderer.flash.v = Math.max(0, this.renderer.flash.v - dt * 2.4);
    this.renderer.particles.update(dt);
    if (this.scene !== SCENE.GAME || !this.session) return;
    if (this.completeT > 0) this.completeT += dt;
    if (this.paused) return;
    if (this.session.state === STATE.COMPLETE) return;

    this.acc += dt;
    const STEP = 1 / 60;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.stepGame();
      this.acc -= STEP;
      steps++;
    }
    if (this.acc >= STEP) this.acc = 0;

    const s = this.session;
    const targetZoom = s.state === STATE.COMPLETE ? 1.06 : 1;
    this.camera.targetZoom = (this.camera.baseZoom || 1) * targetZoom;
    this.camera.update(dt, s.world, {
      canvasW: this.w,
      canvasH: this.h,
      shake: !!this.save.settings.shake,
      reducedMotion: !!this.save.settings.reducedMotion,
    });
  }

  // --- frame ---------------------------------------------------------------

  view(dt) {
    return {
      session: this.session,
      world: this.session ? this.session.world : null,
      camera: this.camera,
      pal: this.pal,
      save: this.save,
      levels: this.levels,
      maxUnlocked: this.maxUnlocked,
      hasProgress: this.hasProgress,
      totalDeaths: this.save.data.totalDeaths || 0,
      settings: this.save.settings,
      completeT: this.completeT,
      fps: this.fps,
      debug: this.debug,
      dt,
    };
  }

  render(dt) {
    const ctx = this.renderer.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const view = this.view(dt);
    const ui = this.ui;

    if (this.scene === SCENE.GAME && this.session) {
      this.renderer.render(view);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ui.begin(ctx, dt);
      ui.drawHUD(view);
      if (this.session.state === STATE.DEAD) this.drawDeathOverlay(ui);
      if (this.completeT > 0.55) ui.drawComplete(view);
      if (this.paused) ui.drawPause(view);
      if (this.debug) this.drawDebugPanels(ui, view);
      if (this.transition) this.drawTransition(ui, view);
    } else {
      this.renderer.drawBackdrop(ctx, { x: 300, y: 200 }, this.pal, this.w, this.h, view);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ui.begin(ctx, dt);
      if (this.scene === SCENE.MENU) ui.drawMenu(view);
      else if (this.scene === SCENE.SELECT) ui.drawLevelSelect(view);
      else if (this.scene === SCENE.SETTINGS) ui.drawSettings(view);
      else if (this.scene === SCENE.CREDITS) ui.drawCredits(view);
      if (this.transition) this.drawTransition(ui, view);
      if (this.flashFx.v > 0.01) {
        ctx.save();
        ctx.globalAlpha = this.flashFx.v * 0.4;
        ctx.fillStyle = this.flashFx.color;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.restore();
      }
    }
    if (this.scene === SCENE.GAME && this.flashFx.v > 0.01) {
      ctx.save();
      ctx.globalAlpha = this.flashFx.v * 0.32;
      ctx.fillStyle = this.flashFx.color;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }
  }

  drawDeathOverlay(ui) {
    const ctx = ui.ctx;
    const pal = this.pal;
    const s = this.session;
    const a = clamp(this.deathHold / DEATH_HOLD_TICKS, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, this.h * 0.34, this.w, 120);
    ctx.restore();
    ui.text('SIGNAL LOST', this.w / 2, this.h * 0.34 + 46, {
      size: 26,
      align: 'center',
      letterSpacing: 12,
      color: pal.danger,
      glow: rgbaHex(pal.danger, 0.8),
    });
    ui.text(`REWINDING · ${s.world.failReason || 'TIMELINE COLLAPSE'}`, this.w / 2, this.h * 0.34 + 70, {
      size: 11,
      align: 'center',
      letterSpacing: 3,
      color: rgbaHex(pal.trim, 0.95),
    });
    ui.bar(this.w / 2 - 160, this.h * 0.34 + 88, 320, a, pal, pal.echo);
    ui.text('PRESS  R  TO REWIND NOW', this.w / 2, this.h * 0.34 + 112, {
      size: 10,
      align: 'center',
      letterSpacing: 3,
      color: rgbaHex(pal.interact, 0.85),
    });
  }

  drawDebugPanels(ui, view) {
    const ctx = ui.ctx;
    const pal = this.pal;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(this.w - 250, 92, 232, 92);
    ctx.restore();
    const lines = [
      `FPS ${this.fps.toFixed(0)}`,
      `SCENE ${this.scene}${this.paused ? ' PAUSED' : ''}`,
      `ECHOES ${view.world ? view.world.echoes.length : 0}  EVENTS ${this.session ? this.session.recorder.events.length : 0}`,
      `SYNC ${(this.session ? this.session.syncAverage : 1) * 100 | 0}%  TICK ${view.world ? view.world.tick : 0}`,
      `PARTICLES ${this.renderer.particles.count}`,
    ];
    lines.forEach((l, i) => ui.text(l, this.w - 238, 112 + i * 16, { size: 11, color: '#7dffd8' }));
  }

  // Screen transitions: temporal displacement wipes.
  drawTransition(ui, view) {
    const tr = this.transition;
    if (!tr) return;
    const ctx = ui.ctx;
    const pal = this.pal;
    const k = clamp(tr.t / tr.dur, 0, 1);
    const reduced = !!this.save.settings.reducedMotion;
    ctx.save();
    if (tr.kind === 'enter') {
      const w = this.w;
      const h = this.h;
      const bands = 14;
      const cover = clamp(1 - easeOutCubic(k) * 1.25, 0, 1);
      for (let i = 0; i < bands; i++) {
        const bh = h / bands;
        const dir = i % 2 ? 1 : -1;
        const x = dir < 0 ? -w * cover : w * cover;
        ctx.globalAlpha = cover * 0.98;
        ctx.fillStyle = i % 3 === 0 ? rgbaHex(pal.voidDeep, 1) : rgbaHex(pal.void, 1);
        ctx.fillRect(x, i * bh, w, bh + 1);
        if (cover > 0.02 && !reduced) {
          ctx.globalAlpha = cover * 0.5;
          ctx.fillStyle = i % 2 ? rgbaHex(pal.interact, 1) : rgbaHex(pal.corrupt, 1);
          ctx.fillRect(x + dir * 8, i * bh + bh - 2, w * 0.4, 1);
        }
      }
      const titleA = Math.sin(clamp(k * 1.6, 0, 1) * Math.PI);
      if (titleA > 0.01 && this.session) {
        ctx.globalAlpha = titleA;
        ui.text(`ROOM ${String(this.session.levelDef.id).padStart(2, '0')}`, this.w / 2, this.h / 2 - 14, {
          size: 14,
          align: 'center',
          letterSpacing: 10,
          color: rgbaHex(pal.interact, 1),
        });
        ui.text(this.session.levelDef.name, this.w / 2, this.h / 2 + 16, {
          size: 24,
          align: 'center',
          letterSpacing: 8,
          color: pal.player,
        });
        ui.text((this.session.levelDef.hint || '').slice(0, 46), this.w / 2, this.h / 2 + 40, {
          size: 10,
          align: 'center',
          letterSpacing: 2,
          color: rgbaHex(pal.warn, 0.9),
        });
      }
    } else if (tr.kind === 'rewind') {
      const w = this.w;
      const h = this.h;
      ctx.globalAlpha = clamp(Math.sin(k * Math.PI) * 0.9, 0, 1);
      for (let i = 0; i < 22; i++) {
        const y = ((i * 7 + k * h * 1.4) % (h + 40)) - 20;
        const hh = 3 + ((i * 5) % 16);
        ctx.fillStyle = i % 3 === 0 ? rgbaHex(pal.corrupt, 0.5) : i % 3 === 1 ? rgbaHex(pal.interact, 0.35) : rgbaHex(pal.player, 0.25);
        ctx.fillRect(-((i * 37) % 60) + k * 90, y, w, hh);
      }
      ctx.globalAlpha = clamp(Math.sin(k * Math.PI), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, h * 0.44, w, 56);
      ui.text('\u25c0\u25c0  REWIND', this.w / 2, h * 0.44 + 36, {
        size: 18,
        align: 'center',
        letterSpacing: 10,
        color: pal.echo,
        glow: rgbaHex(pal.echo, 0.8),
      });
    }
    ctx.restore();
  }

  // --- loop ----------------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.4) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this.update(dt);
    this.render(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  start() {
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
      const boot = document.getElementById('boot');
      if (boot) {
        boot.classList.add('off');
        setTimeout(() => boot.remove(), 600);
      }
    });
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function rgbaHex(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const app = new App();
window.__echoShift = app; // debug handle (used by the QA harness)
app.start();
