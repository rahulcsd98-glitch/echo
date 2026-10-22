// Persistence: progression + settings. Everything is optional (private mode,
// file://, quota errors) so every read is defensive and every write is guarded.
const KEY = 'echo-shift.save.v2';

export const DEFAULT_SETTINGS = {
  master: 0.85,
  sfx: 0.8,
  music: 0.5,
  shake: true,
  vfx: true,
  reducedMotion: false,
  scanlines: true,
};

function fresh() {
  return {
    unlocked: 1,
    completed: {}, // levelId -> { attempts, ticks, echoes }
    best: {}, // levelId -> ticks
    settings: { ...DEFAULT_SETTINGS },
    firstRun: true,
  };
}

export class Save {
  constructor() {
    this.data = fresh();
    this.load();
  }

  load() {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      this.data = {
        ...fresh(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        completed: parsed.completed && typeof parsed.completed === 'object' ? parsed.completed : {},
        best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
      };
    } catch {
      // corrupted or unavailable storage is not fatal
    }
  }

  write() {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // quota / disabled storage: keep playing with in-memory progress
    }
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.write();
  }

  isUnlocked(id) {
    return id <= (this.data.unlocked || 1);
  }

  unlock(id) {
    if (id > (this.data.unlocked || 1)) {
      this.data.unlocked = id;
      this.write();
    }
  }

  complete(id, stats) {
    const prev = this.data.completed[id];
    if (!prev || stats.attempts < prev.attempts) {
      this.data.completed[id] = stats;
    }
    const b = this.data.best[id];
    if (!b || stats.ticks < b) this.data.best[id] = stats.ticks;
    this.unlock(Math.min(id + 1, 99));
    this.data.firstRun = false;
    this.write();
  }

  resetProgress() {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.write();
  }
}

export function formatTicks(ticks) {
  const total = Math.round(ticks / 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
