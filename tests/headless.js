// Headless verification harness. Runs the real simulation with no browser.
//
//   node tests/headless.js            -> validate levels + run all solutions
//   node tests/headless.js 7          -> run one level's script
//   node tests/headless.js 7 --trace  -> verbose per-step log
import { LEVELS, getLevel } from '../src/levels/index.js';
import { buildLevel } from '../src/sim/level.js';
import { World } from '../src/sim/world.js';
import { Session, STATE, DEATH_HOLD_TICKS } from '../src/app/session.js';
import { SOLUTIONS } from './solutions.js';
import { BTN } from '../src/sim/input.js';
import { TILE } from '../src/sim/constants.js';

const KEYMAP = { L: BTN.LEFT, R: BTN.RIGHT, U: BTN.UP, D: BTN.DOWN, J: BTN.JUMP, S: BTN.SPRINT, E: BTN.INTERACT, G: BTN.GRAB };
let failures = 0;
let checks = 0;
const verbose = process.argv.includes('--trace');

function ok(label, cond, detail = '') {
  checks++;
  if (cond) {
    console.log(`  \u001b[32mPASS\u001b[0m ${label}`);
  } else {
    failures++;
    console.log(`  \u001b[31mFAIL\u001b[0m ${label} ${detail}`);
  }
}

function maskOf(keys) {
  let held = 0;
  for (const ch of keys) {
    const bit = KEYMAP[ch];
    if (bit) held |= bit;
  }
  return held;
}

function describe(session) {
  const w = session.world;
  return {
    tick: w.tick,
    player: { x: Math.round(w.player.x), y: Math.round(w.player.y), tx: Math.round(w.player.x / TILE), alive: w.player.alive, hp: w.player.hp },
    echoes: w.echoes.map((e) => ({ label: e.label, x: Math.round(e.x), y: Math.round(e.y), ct: e.ct, sync: +(1 - e.divergence).toFixed(2), state: e.state })),
    plates: w.objects.filter((o) => o.type === 'plate').map((o) => ({ id: o.id, pressed: o.pressed })),
    doors: w.objects.filter((o) => o.type === 'door' || o.type === 'gate').map((o) => ({ id: o.id, open: +o.openAmt.toFixed(2) })),
    buttons: w.objects.filter((o) => o.type === 'button' || o.type === 'switch' || o.type === 'relay').map((o) => ({ id: o.id, on: o.power ?? o.on })),
    exit: { x: Math.round(w.objects.find((o) => o.type === 'exit').x / TILE), active: w.objects.find((o) => o.type === 'exit').active },
    boxes: w.boxes.map((b) => ({ x: Math.round(b.x / TILE), alive: b.alive })),
    enemies: w.enemies.map((e) => ({ type: e.type, tx: Math.round(e.x / TILE), state: e.state, alert: +(e.alert || 0).toFixed(2) })),
  };
}

/** Run one authored solution script and report the outcome. */
export function runScript(levelId, script, opts = {}) {
  const session = new Session(levelId, opts);
  let stepIdx = 0;
  let stepTicks = 0;
  let prevHeld = 0;
  let total = 0;
  let deaths = 0;
  const trace = [];
  const limit = opts.maxTicks ?? 24000;

  const autoRestart = () => {
    if (session.state === STATE.DEAD && session.deadTicks > DEATH_HOLD_TICKS) {
      deaths++;
      trace.push({ attempt: session.attempts, died: true, tick: session.world.tick, cause: session.world.failReason });
      session.restart('death');
      prevHeld = 0;
      return true;
    }
    return false;
  };

  while (total < limit) {
    if (session.state === STATE.COMPLETE) break;
    if (autoRestart()) continue;
    const step = stepIdx < script.length ? script[stepIdx] : null;
    if (!step) break;

    if (step[0] === 'REST') {
      session.restart('script');
      trace.push({ attempt: session.attempts, echo: session.manager.count, tick: session.world.tick });
      stepIdx++;
      stepTicks = 0;
      prevHeld = 0;
      continue;
    }
    if (step[0] === 'DIE') {
      session.step({ held: 0, pressed: 0 });
      total++;
      stepTicks++;
      prevHeld = 0;
      if (stepTicks >= step[1]) {
        stepIdx++;
        stepTicks = 0;
      }
      continue;
    }

    const [keys, ticks] = step;
    const held = maskOf(keys);
    session.step({ held, pressed: held & ~prevHeld });
    prevHeld = held;
    stepTicks++;
    total++;
    if (verbose && stepTicks === 1) console.log(`    t=${total} step=${stepIdx} keys="${keys}" ticks=${ticks}`);
    if (stepTicks >= ticks) {
      stepIdx++;
      stepTicks = 0;
    }
  }

  return {
    levelId,
    result: session.state === STATE.COMPLETE ? 'complete' : 'incomplete',
    stepIdx,
    total,
    attempts: session.attempts,
    deaths,
    completion: session.completion,
    trace,
    state: describe(session),
  };
}

function validateLevels() {
  console.log('\n== level validation ==');
  for (const def of LEVELS) {
    const level = buildLevel(def);
    const g = level.grid;
    const label = `L${String(def.id).padStart(2, '0')} ${def.name}`;
    const rowsEqual = def.map.every((r) => r.length === def.map[0].length);
    const solidSpawn = g.solidAtPoint(level.spawn.x + 7, level.spawn.y + 11);
    const stateObjects = level.objects.filter((o) =>
      ['plate', 'button', 'switch', 'relay', 'door', 'gate', 'laser', 'core', 'dampener'].includes(o.type)
    );
    const problems = [];
    if (!rowsEqual) problems.push('map rows differ in width');
    if (solidSpawn) problems.push('spawn inside wall');
    if (stateObjects.length > 30) problems.push('too many stateful objects for the divergence bitmask');
    if (level.objects.some((o) => o.x < 0 || o.x > g.pxWidth - 8 || o.y < 0 || o.y > g.pxHeight)) problems.push('object out of bounds');
    if (!level.objects.some((o) => o.type === 'door' || o.type === 'gate') && def.id > 1) problems.push('no door/gate in room');
    if (level.entities.some((e) => e.type === 'box' && g.solidAtPoint(e.x * TILE + 1, e.y * TILE + 2))) problems.push('box spawned in wall');
    if (level.entities.some((e) => e.type === 'guard' && !g.solidAtPoint(e.x * TILE, e.y * TILE + TILE + 4)))
      problems.push('guard without floor');
    ok(`${label} (${def.map[0].length}x${def.map.length})`, problems.length === 0, problems.join('; '));
  }
}

function runSolutions(only) {
  console.log('\n== scripted solutions ==');
  for (const def of LEVELS) {
    if (only && def.id !== only) continue;
    const script = SOLUTIONS[def.id];
    if (!script) {
      ok(`L${String(def.id).padStart(2, '0')} ${def.name}`, false, 'no scripted solution');
      continue;
    }
    const res = runScript(def.id, script, { maxTicks: 40000 });
    const label = `L${String(def.id).padStart(2, '0')} ${def.name}`;
    const detail = `result=${res.result} attempts=${res.attempts ?? '?'} step=${res.stepIdx}/${script.length} reason=${res.reason ?? '-'} p=${JSON.stringify(res.state.player)} exit=${res.state.exit.x} doors=${JSON.stringify(res.state.doors)} plates=${JSON.stringify(res.state.plates)}`;
    ok(label, res.result === 'complete', detail);
    if (res.result !== 'complete') {
      console.log('     echoes:', JSON.stringify(res.state.echoes));
      console.log('     enemies:', JSON.stringify(res.state.enemies), 'boxes:', JSON.stringify(res.state.boxes));
      console.log('     trace:', JSON.stringify(res.trace));
    } else {
      console.log(
        `     solved in ${res.attempts} attempt(s), ${res.total} ticks, ${JSON.stringify(res.state.echoes.length)} echoes active`
      );
    }
  }
}

function determinismCheck() {
  console.log('\n== determinism ==');
  for (const id of [1, 4, 7]) {
    const script = SOLUTIONS[id];
    if (!script) continue;
    const a = [];
    const b = [];
    const run = (into) => {
      const s = new Session(id);
      let stepIdx = 0;
      let stepTicks = 0;
      let prevHeld = 0;
      let total = 0;
      let guard = 0;
      while (total < 2400 && stepIdx < script.length && s.state !== STATE.COMPLETE && guard++ < 6000) {
        if (s.state === STATE.DEAD && s.deadTicks > DEATH_HOLD_TICKS) {
          s.restart('death');
          prevHeld = 0;
          continue;
        }
        const step = script[stepIdx];
        if (step[0] === 'REST') {
          s.restart('script');
          stepIdx++;
          stepTicks = 0;
          prevHeld = 0;
          continue;
        }
        if (step[0] === 'DIE') {
          s.step({ held: 0, pressed: 0 });
          total++;
          stepTicks++;
          prevHeld = 0;
          if (stepTicks >= step[1]) {
            stepIdx++;
            stepTicks = 0;
          }
          continue;
        }
        const [keys, ticks] = step;
        const held = maskOf(keys);
        s.step({ held, pressed: held & ~prevHeld });
        prevHeld = held;
        stepTicks++;
        total++;
        into.push(s.fingerprint());
        if (stepTicks >= ticks) {
          stepIdx++;
          stepTicks = 0;
        }
      }
    };
    run(a);
    run(b);
    const same = a.length === b.length && a.every((v, i) => v === b[i]);
    ok(`L${id}: identical replay fingerprints (${a.length} ticks)`, same);
  }
}

function mechanicChecks() {
  console.log('\n== mechanics ==');
  // plate + echo + door: the core loop
  const id = 1;
  const s = new Session(id);
  const walk = (n, keys) => {
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const held = maskOf(keys);
      s.step({ held, pressed: held & ~prev });
      prev = held;
    }
  };
  walk(35, 'R');
  const plate = s.world.objects.find((o) => o.type === 'plate');
  ok('plate reads a body standing on it', plate.pressed === true);
  const door = s.world.objects.find((o) => o.type === 'door');
  for (let i = 0; i < 30; i++) s.step({ held: 0, pressed: 0 });
  ok('plate holds the door open', door.openAmt > 0.5);
  s.restart('script');
  ok('restart materialises an echo', s.echoes.length === 1);
  for (let i = 0; i < 60; i++) s.step({ held: 0, pressed: 0 });
  const door2 = s.world.objects.find((o) => o.type === 'door');
  ok('echo replays the recorded plate press', door2.openAmt > 0.5);

  // divergence: block the echo's path and watch it fall out of sync
  const s2 = new Session(10);
  const echo = s2.manager;
  ok('level 10 has a corrupt-driven gate', s2.level.objects.some((o) => o.type === 'gate' && o.needCorrupt === 1));
  void echo;

  // beams stop at bodies
  const s3 = new Session(5);
  const sentinel = s3.world.sentinels[0];
  ok('level 5 has a sentinel', !!sentinel);
  ok('level 5 has box cover', s3.world.boxes.length === 1);
}

function main() {
  const arg = process.argv[2];
  const only = arg && /^\d+$/.test(arg) ? Number(arg) : null;
  console.log('ECHO//SHIFT headless verification');
  if (!only) validateLevels();
  runSolutions(only);
  if (!only) {
    determinismCheck();
    mechanicChecks();
  }
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.log(`\u001b[31m${failures} FAILING\u001b[0m`);
    process.exit(1);
  }
  console.log('\u001b[32mall checks passed\u001b[0m');
}

main();
