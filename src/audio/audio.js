// Procedural audio. Every sound is synthesised at runtime from oscillators and
// a single shared noise buffer, so the game ships with zero audio assets and
// still has a full soundscape. Echo sources are routed through a damped bus:
// the past always sounds slightly filtered and out of place.
const NOISE_SECONDS = 1.2;

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.volumes = { master: 0.85, sfx: 0.8, music: 0.5 };
    this.ambient = null;
    this.tension = 0;
    this.lastStep = 0;
  }

  unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) {
      this.enabled = false;
      return;
    }
    try {
      const ctx = new AC();
      this.ctx = ctx;

      const master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.connect(master);
      const music = ctx.createGain();
      music.connect(master);

      // temporal bus: everything your past does lands here
      const echoIn = ctx.createGain();
      const echoLP = ctx.createBiquadFilter();
      echoLP.type = 'lowpass';
      echoLP.frequency.value = 2100;
      echoLP.Q.value = 0.6;
      echoIn.connect(echoLP);
      echoLP.connect(sfx);

      const delay = ctx.createDelay(0.6);
      delay.delayTime.value = 0.19;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(master);

      const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let seed = 1337;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x3fffffff - 1) * 0.9;
      }

      this.master = master;
      this.sfxBus = sfx;
      this.musicBus = music;
      this.echoBus = echoIn;
      this.delay = delay;
      this.noiseBuffer = noiseBuf;
      this.ready = true;
      this.applyVolumes();
    } catch {
      this.enabled = false;
    }
  }

  applyVolumes() {
    if (!this.ready) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
  }

  setVolumes(v) {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // --- primitives ----------------------------------------------------------

  tone(cfg) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = this.now + (cfg.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = cfg.type || 'sine';
    osc.frequency.setValueAtTime(cfg.freq, t);
    if (cfg.freq2 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, cfg.freq2), t + (cfg.dur || 0.2));
    }
    const gain = ctx.createGain();
    const vol = (cfg.vol ?? 0.3) * (cfg.sfx === false ? 1 : 1);
    const atk = cfg.attack ?? 0.005;
    const dur = cfg.dur ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = osc;
    if (cfg.filter) {
      const f = ctx.createBiquadFilter();
      f.type = cfg.filterType || 'lowpass';
      f.frequency.value = cfg.filter;
      f.Q.value = cfg.q ?? 1;
      if (cfg.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, cfg.filterTo), t + dur);
      node.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(cfg.bus || this.sfxBus);
    if (cfg.send) gain.connect(this.delay);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(cfg) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = this.now + (cfg.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const dur = cfg.dur ?? 0.15;
    const gain = ctx.createGain();
    const vol = cfg.vol ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + (cfg.attack ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const f = ctx.createBiquadFilter();
    f.type = cfg.filterType || 'bandpass';
    f.frequency.value = cfg.filter ?? 900;
    f.Q.value = cfg.q ?? 1.1;
    if (cfg.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, cfg.filterTo), t + dur);
    src.connect(f);
    f.connect(gain);
    gain.connect(cfg.bus || this.sfxBus);
    if (cfg.send) gain.connect(this.delay);
    src.start(t, (cfg.offset || 0) % NOISE_SECONDS);
    src.stop(t + dur + 0.02);
  }

  // --- one-shot library ----------------------------------------------------

  play(name, opts = {}) {
    if (!this.ready || !this.enabled) return;
    const bus = opts.echo ? this.echoBus : this.sfxBus;
    const detune = opts.pitch ?? 1;
    switch (name) {
      case 'step':
        this.noise({ dur: 0.07, vol: 0.1 * (opts.vol ?? 1), filter: 480 * detune, q: 0.9, filterType: 'lowpass', bus });
        break;
      case 'land':
        this.noise({ dur: 0.16, vol: 0.22 * (opts.vol ?? 1), filter: 260 * detune, filterTo: 90, q: 0.8, filterType: 'lowpass', bus });
        break;
      case 'jump':
        this.tone({ freq: 320 * detune, freq2: 520 * detune, dur: 0.1, vol: 0.09, type: 'triangle', bus });
        break;
      case 'plate':
        this.tone({ freq: 720 * detune, freq2: 1180 * detune, dur: 0.16, vol: 0.14, type: 'square', filter: 2600, bus });
        this.noise({ dur: 0.06, vol: 0.08, filter: 1500, bus });
        break;
      case 'plate_up':
        this.tone({ freq: 560 * detune, freq2: 320 * detune, dur: 0.14, vol: 0.09, type: 'square', filter: 1800, bus });
        break;
      case 'button':
        this.tone({ freq: 210 * detune, freq2: 420 * detune, dur: 0.09, vol: 0.16, type: 'square', filter: 1400, bus });
        break;
      case 'switch':
        this.noise({ dur: 0.09, vol: 0.16, filter: 2200, q: 3, bus });
        this.tone({ freq: 900 * detune, dur: 0.06, vol: 0.07, type: 'triangle', bus });
        break;
      case 'relay':
        this.tone({ freq: 1400 * detune, dur: 0.05, vol: 0.1, type: 'square', filter: 3400, bus });
        this.tone({ freq: 2100 * detune, dur: 0.05, vol: 0.06, type: 'square', delay: 0.06, bus });
        break;
      case 'door':
        this.noise({ dur: 0.5, vol: 0.15 * (opts.vol ?? 1), filter: 320, q: 1.6, filterTo: 120, filterType: 'lowpass', bus });
        this.tone({ freq: 120 * detune, freq2: 62 * detune, dur: 0.45, vol: 0.12, type: 'sawtooth', filter: 700, bus });
        break;
      case 'gate':
        this.tone({ freq: 240 * detune, freq2: 900 * detune, dur: 0.7, vol: 0.1, type: 'sine', filter: 2400, send: true, bus });
        this.noise({ dur: 0.6, vol: 0.08, filter: 900, filterTo: 3200, q: 0.7, bus });
        break;
      case 'laser':
        this.tone({ freq: 1800 * detune, freq2: 240 * detune, dur: 0.24, vol: 0.14, type: 'sawtooth', filter: 3000, bus });
        this.noise({ dur: 0.2, vol: 0.1, filter: 4200, q: 0.6, bus });
        break;
      case 'hurt':
        this.tone({ freq: 420 * detune, freq2: 110, dur: 0.34, vol: 0.28, type: 'square', filter: 1200, bus });
        this.noise({ dur: 0.22, vol: 0.2, filter: 600, q: 0.8, filterType: 'lowpass', bus });
        break;
      case 'death':
        this.tone({ freq: 300, freq2: 42, dur: 1.1, vol: 0.3, type: 'sawtooth', filter: 1400, filterTo: 90, send: true });
        this.noise({ dur: 1.0, vol: 0.16, filter: 700, filterTo: 90, filterType: 'lowpass' });
        break;
      case 'echo_spawn':
        this.tone({ freq: 220 * detune, freq2: 880 * detune, dur: 0.85, vol: 0.16, type: 'sine', filter: 3000, send: true, bus });
        this.tone({ freq: 330 * detune, freq2: 1320 * detune, dur: 0.75, vol: 0.08, type: 'triangle', delay: 0.07, send: true, bus });
        break;
      case 'echo_death':
        this.tone({ freq: 900 * detune, freq2: 60 * detune, dur: 0.7, vol: 0.2, type: 'triangle', filter: 2200, send: true, bus });
        this.noise({ dur: 0.5, vol: 0.14, filter: 1800, filterTo: 200, bus });
        break;
      case 'echo_corrupt':
        this.tone({ freq: 180, freq2: 1240, dur: 0.5, vol: 0.16, type: 'square', filter: 3600, q: 6, send: true, bus });
        this.noise({ dur: 0.6, vol: 0.14, filter: 2400, q: 0.7, bus });
        break;
      case 'alert':
        this.tone({ freq: 520, dur: 0.16, vol: 0.2, type: 'square', filter: 2000 });
        this.tone({ freq: 300, dur: 0.3, vol: 0.18, type: 'square', filter: 1600, delay: 0.18 });
        break;
      case 'complete':
        [0, 0.11, 0.22, 0.36].forEach((d, i) => {
          const f = [523.25, 659.25, 783.99, 1046.5][i];
          this.tone({ freq: f, dur: 0.75, vol: 0.14, type: 'triangle', filter: 3200, delay: d, send: true });
          this.tone({ freq: f * 2, dur: 0.4, vol: 0.05, type: 'sine', delay: d + 0.02, send: true });
        });
        break;
      case 'rewind':
        this.tone({ freq: 160, freq2: 1900, dur: 0.42, vol: 0.16, type: 'sawtooth', filter: 900, filterTo: 4200, send: true });
        break;
      case 'ui_move':
        this.tone({ freq: 900 * detune, dur: 0.05, vol: 0.07, type: 'square', filter: 3000 });
        break;
      case 'ui_click':
        this.tone({ freq: 1400 * detune, freq2: 700, dur: 0.11, vol: 0.11, type: 'square', filter: 3600 });
        break;
      case 'ui_back':
        this.tone({ freq: 520, freq2: 300, dur: 0.12, vol: 0.09, type: 'triangle', filter: 2200 });
        break;
      case 'unlock':
        [0, 0.09, 0.2].forEach((d, i) => {
          this.tone({ freq: [659.25, 880, 1174.66][i], dur: 0.6, vol: 0.1, type: 'triangle', delay: d, send: true });
        });
        break;
      case 'type':
        this.noise({ dur: 0.03, vol: 0.05, filter: 2600, q: 2 });
        break;
      default:
        break;
    }
  }

  // Footsteps and body noise derived straight from the world state.
  bodyNoise(world, player, muted) {
    if (player.onGround && Math.abs(player.vx) > 0.6) {
      const interval = Math.abs(player.vx) > 4 ? 13 : 22;
      if (world.tick - this.lastStep >= interval) {
        this.lastStep = world.tick;
        if (!muted) this.play('step', { vol: 0.6 });
      }
    }
  }

  // --- ambient room tone ---------------------------------------------------

  startAmbient(paletteIndex, levelId) {
    if (!this.ready || !this.enabled) return;
    this.stopAmbient();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.musicBus);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 3.5;
    filter.connect(out);

    const roots = [55, 61.74, 49, 46.25, 43.65, 58.27];
    const root = roots[paletteIndex % roots.length] * (1 + (levelId % 3) * 0.01);
    const oscs = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'sine';
      o.frequency.value = root * (i === 0 ? 1 : i === 1 ? 2 : 3.02);
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.18;
      o.connect(g);
      g.connect(filter);
      o.start();
      oscs.push(o);
    }

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05 + (levelId % 5) * 0.011;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    oscs.push(lfo);

    // air
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 340;
    airF.Q.value = 0.6;
    const airG = ctx.createGain();
    airG.gain.value = 0.05;
    air.connect(airF);
    airF.connect(airG);
    airG.connect(out);
    air.start();

    out.gain.linearRampToValueAtTime(0.5, this.now + 2.5);
    this.ambient = { out, oscs, air, filter, airG };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const a = this.ambient;
    this.ambient = null;
    try {
      a.out.gain.cancelScheduledValues(this.now);
      a.out.gain.setValueAtTime(a.out.gain.value, this.now);
      a.out.gain.linearRampToValueAtTime(0.0001, this.now + 0.8);
      const stopAt = this.now + 0.9;
      a.oscs.forEach((o) => o.stop(stopAt));
      a.air.stop(stopAt);
    } catch {
      // already stopped
    }
  }

  updateTension(t) {
    this.tension = t;
    if (!this.ambient) return;
    const target = 320 + t * 1500;
    this.ambient.filter.frequency.value += (target - this.ambient.filter.frequency.value) * 0.02;
    this.ambient.airG.gain.value += (0.03 + t * 0.07 - this.ambient.airG.gain.value) * 0.02;
  }
}
