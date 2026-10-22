// Debug probe / solution tuner.
//
//   node tests/probe.js 4              -> run L4's script, dump state every 10 ticks
//   node tests/probe.js 4 --every 4    -> dump every 4 ticks
//   node tests/probe.js 4 --script 'json'  -> run a custom script
//   node tests/probe.js 4 --events     -> also dump world events
//
// It reports solid-tile overlaps (should never happen) and the first death.
import { Session, STATE, DEATH_HOLD_TICKS } from '../src/app/session.js';
import { SOLUTIONS } from './solutions.js';
import { BTN } from '../src/sim/input.js';
import { TILE } from '../src/sim/constants.js';

const KEYMAP = { L: BTN.LEFT, R: BTN.RIGHT, U: BTN.UP, D: BTN.DOWN, J: BTN.JUMP, S: BTN.SPRINT, E: BTN.INTERACT, G: BTN.GRAB };
const args = process.argv.slice(2);
const id = Number(args.find((a) => /^\d+$/.test(a)) || 12);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const every = Number(flag('--every', 10));
const scriptArg = flag('--script', null);
const showEvents = args.includes('--events');
const script = scriptArg ? JSON.parse(scriptArg) : SOLUTIONS[id];

const session = new Session(id);

function bodies(w) {
  return [w.player, ...w.echoes, ...w.boxes, ...w.enemies];
}

let violations = 0;
function checkSolid(w) {
  for (const b of bodies(w)) {
    if (!b || !b.alive || b.carriedBy) continue;
    if (w.grid.overlapsSolid(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1)) {
      console.log(`!! SOLID OVERLAP tick=${w.tick} ${b.kind || b.type} x=${b.x.toFixed(1)} y=${b.y.toFixed(1)}`);
      violations++;
      return;
    }
  }
}

const r = (v) => Math.round(v);
function dump(w, tag) {
  const p = w.player;
  const plats = w.behaviors.filter((b) => b.kind === 'platform').map((b) => `[${r(b.o.x / TILE)},${r(b.o.y / TILE)}]`).join('');
  const boxes = w.boxes.map((b) => `${b.alive ? r(b.x / TILE) : 'x'}${b.carriedBy ? '^' : ''}`).join('/');
  const plates = w.objects.filter((o) => o.type === 'plate').map((o) => (o.pressed ? 1 : 0)).join('');
  const doors = w.objects.filter((o) => o.type === 'door' || o.type === 'gate').map((o) => `${o.type[0]}${o.openAmt > 0.5 ? 1 : 0}`).join('');
  const echoes = w.echoes
    .map((e) => {
      const m = e.lastMeasure;
      const dbg = m ? `(pe${m.posErr.toFixed(0)} sm${m.stateMismatch}${m.boxMismatch ? ' bx' : ''})` : '';
      return `${e.label}:${e.state[0]}${(1 - e.divergence).toFixed(2)}@${r(e.x / TILE)}${dbg}`;
    })
    .join(' ');
  console.log(
    `t=${String(w.tick).padStart(4)} ${tag.padEnd(10)} p=(${p.x.toFixed(0)},${p.y.toFixed(0)}) v=(${p.vx.toFixed(1)},${p.vy.toFixed(1)}) ${p.alive ? 'g' + (p.onGround ? 1 : 0) : 'DEAD'} plat=${plats} box=${boxes} pl=${plates} dr=${doors} ${echoes}`
  );
}

let stepIdx = 0;
let stepTicks = 0;
let prevHeld = 0;
let total = 0;

while (total < 40000) {
  if (session.state === STATE.COMPLETE) {
    console.log(`COMPLETE at tick ${total} (attempt ${session.attempts})`);
    break;
  }
  if (session.state === STATE.DEAD && session.deadTicks > DEATH_HOLD_TICKS) {
    console.log(`death #${session.deaths} at tick ${total} cause=${session.world.failReason} (attempt ${session.attempts}, step ${stepIdx + 1}/${script.length})`);
    dump(session.world, `death-${session.world.failReason}`);
    if (session.deaths > 3) break;
    session.restart('death');
    prevHeld = 0;
    stepIdx = 0;
    stepTicks = 0;
    continue;
  }
  const step = script[stepIdx];
  if (!step) {
    console.log(`script exhausted at tick ${total} attempt ${session.attempts} state=${session.state}`);
    const w = session.world;
    console.log(`  player tx=${r(w.player.x / TILE)} alive=${w.player.alive}`);
    console.log(`  plates=${JSON.stringify(w.objects.filter((o) => o.type === 'plate').map((o) => [o.id, o.pressed]))}`);
    console.log(`  doors=${JSON.stringify(w.objects.filter((o) => o.type === 'door' || o.type === 'gate').map((o) => [o.id, +o.openAmt.toFixed(2)]))}`);
    console.log(`  boxes=${JSON.stringify(w.boxes.map((b) => [r(b.x / TILE), r(b.y / TILE), b.alive]))}`);
    break;
  }
  if (step[0] === 'REST') {
    console.log(`--- RESTART at tick ${total} (attempt ${session.attempts} -> ${session.attempts + 1})`);
    session.restart('script');
    stepIdx++;
    stepTicks = 0;
    prevHeld = 0;
    continue;
  }
  const [keys, ticks] = step;
  const held = step[0] === 'DIE' ? 0 : [...keys].reduce((a, c) => a | (KEYMAP[c] || 0), 0);
  session.step({ held, pressed: held & ~prevHeld });
  prevHeld = held;
  stepTicks++;
  total++;
  checkSolid(session.world);
  if (violations > 2) break;
  if (session.world.tick % every === 0 || stepTicks === 1) {
    dump(session.world, `s${stepIdx + 1}"${step[0]}"`);
  }
  if (showEvents) {
    const ev = session.world.events;
    if (ev && ev.length) console.log(`    ev ${ev.map((e) => e.type).join(',')}`);
  }
  if (stepTicks >= ticks) {
    stepIdx++;
    stepTicks = 0;
  }
}
console.log('done', session.state, 'violations:', violations);
