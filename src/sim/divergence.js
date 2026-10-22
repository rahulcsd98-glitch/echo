import {
  DIVERGENCE_GAIN,
  DIVERGENCE_POS_WEIGHT,
  DIVERGENCE_SPIKE,
  DIVERGENCE_STATE_WEIGHT,
  TRACE_INTERVAL,
} from './constants.js';
import { clamp } from './math.js';

// ---------------------------------------------------------------------------
// DivergenceDetector: compares an echo's live position and the state of the
// objects it cares about against the trace it recorded. Small drift is
// harmless, structural mismatch destabilises the echo, and at heavy divergence
// the echo collapses into a corrupted state.
// ---------------------------------------------------------------------------

const POS_SCALE = 58;

export function popcount(v) {
  v = v - ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >> 24;
}

export function measure(echo, world) {
  const rec = echo.recording;
  // trace samples land on ticks that are multiples of TRACE_INTERVAL, so the
  // sample for the cursor's current tick is one slot behind the naive index
  const idx = Math.floor(echo.ct / TRACE_INTERVAL) - 1;
  if (idx < 0 || idx >= rec.traceLen) return null;
  const base = idx * 4;
  const ex = rec.trace[base];
  const ey = rec.trace[base + 1];
  const emask = rec.trace[base + 2];
  const ebox = rec.trace[base + 3];

  const posErr = Math.hypot(echo.x - ex, echo.y - ey);
  const objDiff = (world.objectStateMask() ^ emask) & echo.interestMask;
  const stateMismatch = popcount(objDiff);
  const boxMismatch = echo.recording.boxInterested && world.boxHash() !== ebox;

  // A missing box the echo actually used reads as loudly as a door that is in
  // the wrong state: the past can tell something structural changed.
  const stateTerm = Math.max(clamp(stateMismatch / 2, 0, 1), boxMismatch ? 1 : 0);
  const severity =
    DIVERGENCE_POS_WEIGHT * clamp(posErr / POS_SCALE, 0, 1) + DIVERGENCE_STATE_WEIGHT * stateTerm;

  return {
    severity: clamp(severity, 0, 1),
    posErr,
    stateMismatch,
    boxMismatch,
    expected: { x: ex, y: ey },
  };
}

export function applySample(echo, world) {
  const m = measure(echo, world);
  if (!m) return null;
  echo.lastMeasure = m;
  echo.divergence += (m.severity - echo.divergence) * DIVERGENCE_GAIN;
  echo.divergence = clamp(echo.divergence, 0, 1);
  if (m.stateMismatch > 0) echo.mismatchTicks = (echo.mismatchTicks || 0) + 1;
  return m;
}

export function spike(echo, amount = DIVERGENCE_SPIKE) {
  echo.divergence = clamp(echo.divergence + amount, 0, 1);
}

export function syncOf(echo) {
  return clamp(1 - echo.divergence, 0, 1);
}
