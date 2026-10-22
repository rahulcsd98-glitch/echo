import { TILE } from './constants.js';
import { Grid, parseMap } from './tiles.js';

// ---------------------------------------------------------------------------
// Level parsing: hand-authored definitions -> runtime blueprint.
// Objects are described in tile coordinates and expanded to pixel rects.
// Sim, renderer and debug overlays all read the same blueprint.
// ---------------------------------------------------------------------------

const k = (tx) => tx * TILE;
const px = (n) => n * TILE;

function makeObject(def, index) {
  const o = { ...def };
  o.id = `${def.type}:${index}`;
  o.solid = false;
  o.open = false;
  o.press = 0; // 0..1 animation value
  o.active = false;
  o.dead = false;

  switch (def.type) {
    case 'plate':
      o.w = px(def.w || 2);
      o.h = 6;
      o.x = k(def.x);
      o.y = k(def.y) + (TILE - 6);
      break;
    case 'button':
    case 'switch':
      o.w = px(1);
      o.h = px(1);
      o.x = k(def.x);
      o.y = k(def.y);
      o.mode = def.mode || (def.type === 'switch' ? 'toggle' : 'hold');
      break;
    case 'relay':
      o.w = px(1);
      o.h = px(1);
      o.x = k(def.x);
      o.y = k(def.y);
      break;
    case 'door':
      o.h = px(def.h || 3);
      o.w = px(1);
      o.x = k(def.x);
      o.y = k(def.y);
      o.solid = true;
      break;
    case 'gate':
      o.h = px(def.h || 3);
      o.w = px(1);
      o.x = k(def.x);
      o.y = k(def.y);
      o.solid = true;
      o.needEchoes = def.echoes ?? 1;
      o.needCorrupt = def.corrupt ?? 0;
      break;
    case 'laser': {
      const len = px(def.length || 10);
      o.dir = def.dir || 'right';
      o.x = k(def.x);
      o.y = k(def.y) + TILE / 2;
      o.len = len;
      o.period = def.period || 0;
      o.duty = def.duty ?? 1;
      o.phase = def.phase || 0;
      break;
    }
    case 'platform':
      o.w = px(def.w || 3);
      o.h = px(1);
      o.x = k(def.x);
      o.y = k(def.y);
      o.fromX = o.x;
      o.fromY = o.y;
      o.toX = k(def.to[0]);
      o.toY = k(def.to[1]);
      o.period = def.period || 240;
      o.phase = def.phase || 0;
      o.solid = true;
      o.dx = 0;
      o.dy = 0;
      break;
    case 'spikes':
      o.w = px(def.w || 1);
      o.h = 10;
      o.x = k(def.x);
      o.y = k(def.y) + (TILE - 10);
      break;
    case 'dampener':
      o.w = px(def.w || 2);
      o.h = px(def.h || 2);
      o.x = k(def.x);
      o.y = k(def.y);
      o.radius = px(def.radius || 8);
      break;
    case 'core':
      o.w = 14;
      o.h = 14;
      o.x = k(def.x) + 5;
      o.y = k(def.y) + 5;
      break;
    default:
      break;
  }
  return o;
}

export function buildLevel(def) {
  const parsed = parseMap(def.map);
  const grid = new Grid(parsed.w, parsed.h, parsed.cells);
  const objects = (def.objects || []).map(makeObject);
  const spawnTile = def.spawn || parsed.spawns[0] || { tx: 2, ty: 2 };
  const exitTile = def.exit || parsed.exits[0] || { tx: parsed.w - 3, ty: 2 };

  const spawn = {
    x: k(spawnTile.tx) + (TILE - 14) / 2,
    y: k(spawnTile.ty) + (TILE - 22),
  };

  const exitObj = {
    id: 'exit',
    type: 'exit',
    x: k(exitTile.tx),
    y: k(exitTile.ty) - TILE,
    w: TILE,
    h: TILE * 2,
    active: false,
    open: false,
  };

  return {
    def,
    id: def.id,
    name: def.name,
    subtitle: def.subtitle || '',
    hint: def.hint || '',
    prompts: def.prompts || [],
    palette: def.palette || 0,
    grid,
    objects,
    entities: (def.entities || []).map((e, i) => ({ ...e, id: `${e.type}:${i}` })),
    spawn,
    exit: exitObj,
    maxEchoes: def.maxEchoes ?? def.echoes ?? 3,
    par: def.par ?? 2,
    objective: def.objective || 'exit',
    width: grid.pxWidth,
    height: grid.pxHeight,
  };
}

export { k as tileToPx };
