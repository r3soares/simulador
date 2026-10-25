// Paridade: o motor extraído (src/engine) reproduz legacy/simulador.html com a mesma seed.
// Vale enquanto o modelo não mudar de propósito; quando mudar, este teste sai (registrar no CHANGELOG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLegacy } from '../legacy.js';
import { makeSim, snapshot, DT, BASE } from '../helpers.js';
import { mulberry32 } from '../../src/engine/rng.js';

const CASES = [
  ['padrão', {}],
  ['pool saturado', { T:20, W:2, rate:4 }],
  ['timeout curto', { T:20, W:2, rate:4, timeout:5 }],
  ['prefork cliente lento', { arch:'A', T:6, exec:100, slowPct:50, rate:6 }],
  ['event cliente lento', { T:20, W:6, exec:100, slowPct:50, rate:6 }],
  ['sessão arquivo rr', { nb:3, exec:300, session:'file', rate:4 }],
  ['sticky + queda', { nb:3, exec:300, session:'file', rate:4, lb:'ip' }, [[10, s => s.toggleBackend(1)], [25, s => s.toggleBackend(1)]]],
  ['menos conexões', { nb:3, exec:300, lb:'lc', rate:15 }],
  ['redis + queda do redis', { nb:3, exec:300, session:'redis', rate:4 }, [[10, s => { s.redis.up = false; }], [20, s => { s.redis.up = true; }]]],
  ['dynamic rajada', { T:20, W:10, pm:'dynamic', rate:0 }, [[0, s => { for (let i = 0; i < 20; i++) s.spawnReq(); }]]],
  ['ondemand rajada e ocioso', { T:20, W:10, pm:'ondemand', rate:0, exec:300 }, [[0, s => { for (let i = 0; i < 20; i++) s.spawnReq(); }]]],
  ['opcache off', { T:20, W:2, exec:100, opcache:'off', rate:12 }],
  ['backlog cheio (503)', { T:8, W:4, rate:100 }],
  ['todos os backends caem', { nb:2, rate:5 }, [[5, s => { s.toggleBackend(0); s.toggleBackend(1); }]]],
  ['detect 0', { nb:3, rate:6, detect:0 }, [[5, s => s.toggleBackend(2)]]],
];

for (const [name, over, events = []] of CASES) {
  test(`paridade: ${name}`, () => {
    const seed = 12345;
    const old = loadLegacy(mulberry32(seed));
    Object.assign(old.cfg, BASE, over); old.redis.up = true; old.reset();
    const neu = makeSim(over, seed);
    const secs = 40, perSec = 1000 / DT;
    for (let i = 0; i <= secs * perSec; i++) {
      for (const [at, fn] of events) if (i === Math.round(at * perSec)) { fn(old); fn(neu); }
      if (i % Math.round(perSec) === 0) assert.deepEqual(snapshot(neu), snapshot(old), `diverge em t=${i * DT} ms`);
      old.step(DT); neu.step(DT);
    }
  });
}
