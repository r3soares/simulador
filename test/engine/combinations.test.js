// Varre combinações de parâmetros e eventos, checando as invariantes (test/invariants.js) a cada passo.
// Uma falha mostra a configuração e a seed; para reproduzir: makeSim(cfg, seed) e os mesmos eventos.
import { test } from 'node:test';
import { makeSim, DT } from '../helpers.js';
import { createChecker } from '../invariants.js';
import { mulberry32 } from '../../src/engine/rng.js';

const SECS = 14;
// eventos (segundo → ação): rajada, queda e volta de backend, queda e volta do Redis
const EVENTS = [[2, s => s.burst(20)], [4, s => s.toggleBackend(0)], [6, s => s.setRedis(false)], [9, s => s.toggleBackend(0)], [10, s => s.setRedis(true)]];
// capacidade aproximada (req/s) da configuração, para escolher cargas baixa, perto do limite e acima dele
const capacity = c => c.nb * Math.min(c.T, c.arch === 'B' ? c.W : c.T) / ((c.exec + (c.opcache === 'off' ? 120 : 0)) / 1000);

function runCase(cfg, seed, { events = EVENTS, secs = SECS } = {}) {
  const sim = makeSim(cfg, seed), check = createChecker(sim.cfg), perSec = 1000 / DT;
  try {
    for (let i = 0; i < secs * perSec; i++) {
      for (const [at, fn] of events) if (i === Math.round(at * perSec)) fn(sim);
      sim.step(DT); check(sim);
    }
  } catch (e) {
    e.message = `${e.message}\n  seed=${seed} cfg=${JSON.stringify(cfg)}`;
    throw e;
  }
}

// grade: todas as combinações destes valores (arquitetura A ignora pm)
const GRID = { arch:['A', 'B'], nb:[1, 3], lb:['rr', 'ip', 'lc'], pm:['static', 'dynamic', 'ondemand'], session:['none', 'file', 'redis'], slowPct:[0, 50], opcache:['on', 'off'], timeout:[5, 30] };
function* grid() {
  const keys = Object.keys(GRID);
  const rec = function* (i, acc) {
    if (i === keys.length) { yield acc; return; }
    for (const v of GRID[keys[i]]) yield* rec(i + 1, { ...acc, [keys[i]]: v });
  };
  for (const c of rec(0, {})) {
    if (c.arch === 'A' && c.pm !== 'static') continue;
    if (c.nb === 1 && c.lb !== 'rr') continue;
    yield c;
  }
}

test('invariantes: grade de combinações × 3 níveis de carga', () => {
  let n = 0;
  for (const base of grid()) {
    const c = { T:6, W:4, exec:300, ...base };
    const cap = capacity(c);
    for (const load of [0.3, 1, 2.5]) runCase({ ...c, rate:Math.max(1, Math.round(cap * load)) }, 1000 + n++);
  }
});

test('invariantes: 60 configurações aleatórias (seed fixa)', () => {
  const R = mulberry32(2024), pickOf = a => a[Math.floor(R() * a.length)], int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  for (let k = 0; k < 60; k++) {
    const c = {
      arch:pickOf(['A', 'B']), nb:int(1, 3), lb:pickOf(['rr', 'ip', 'lc']), pm:pickOf(['static', 'dynamic', 'ondemand']),
      T:pickOf([1, 2, 4, 8, 20, 64]), W:pickOf([1, 2, 4, 8, 16, 48]), start:int(1, 8), minSpare:int(1, 6), maxSpare:int(1, 10), idleTimeout:int(1, 5),
      exec:int(1, 40) * 50, opcache:pickOf(['on', 'off']), slowPct:pickOf([0, 20, 100]), slowMs:int(1, 8) * 500, session:pickOf(['none', 'file', 'redis']),
      redisMs:int(1, 50), rate:pickOf([0, 1, 5, 20, 80, 300]), timeout:pickOf([5, 10, 30, 120]), detect:int(0, 6),
    };
    runCase(c, 5000 + k, { secs:20 });
  }
});
