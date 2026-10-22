import { Echo } from './echo.js';

// ---------------------------------------------------------------------------
// EchoManager owns the recordings of previous attempts and materialises them
// as echoes at the start of every new attempt.
// ---------------------------------------------------------------------------
export class EchoManager {
  constructor(level) {
    this.level = level;
    this.recordings = [];
    this.nextId = 1;
    this.spawned = 0;
  }

  clear() {
    this.recordings.length = 0;
    this.nextId = 1;
    this.spawned = 0;
  }

  commit(recording) {
    recording.id = this.nextId++;
    this.recordings.push(recording);
    // keep memory bounded: the timeline only ever needs the recent past
    while (this.recordings.length > 8) this.recordings.shift();
    return recording;
  }

  activeRecordings() {
    const max = this.level.maxEchoes;
    if (this.recordings.length <= max) return this.recordings.slice();
    return this.recordings.slice(this.recordings.length - max);
  }

  spawnInto(world) {
    const recs = this.activeRecordings();
    let spawned = 0;
    for (let i = 0; i < recs.length; i++) {
      // index 0 is the most recent echo: newest is the brightest presence
      const recency = recs.length - 1 - i;
      const echo = new Echo(recency, recs[i]);
      echo.label = i + 1; // ECHO 01 is always the oldest in the room
      echo.ageRank = i;
      world.addEcho(echo);
      spawned++;
    }
    this.spawned = spawned;
    return spawned;
  }

  get count() {
    return this.activeRecordings().length;
  }
}
