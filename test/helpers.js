// Utilitários dos testes do motor.
import { createSim } from '../src/engine/sim.js';
import { mulberry32 } from '../src/engine/rng.js';
import { DEFAULTS } from '../src/model/params.js';

export const DT = 16; // passo de simulação usado nos testes (ms), parecido com um quadro de 60 Hz

export function makeSim(over = {}, seed = 1) {
  const cfg = { ...DEFAULTS, ...over };
  const sim = createSim(cfg, { rng:mulberry32(seed) });
  sim.reset();
  return sim;
}

// avança a simulação por `secs` segundos; check(sim) roda a cada passo
export function runFor(sim, secs, check) {
  const n = Math.round(secs * 1000 / DT);
  for (let i = 0; i < n; i++) { sim.step(DT); if (check) check(sim); }
  return sim;
}

// fotografia comparável do estado (usada na paridade e em mensagens de erro)
// (JSON: objetos vindos do vm têm outro protótipo e o deepEqual estrito os trataria como diferentes)
export function snapshot(s) {
  return JSON.parse(JSON.stringify({
    T: Math.round(s.T), done:s.stats.done, errors:s.stats.errors, lost:s.stats.lost, noSess:s.stats.noSess, codes:{ ...s.stats.codes },
    inflight:s.reqs.length, redisOps:s.redis.ops,
    backends:s.backends.map(b => ({ up:b.up, listed:b.listed, thr:b.thrBusy, proc:b.procBusy, apQ:b.apacheQ.length, fpmQ:b.fpmQ.length,
      workers:b.workers.length, busy:b.workers.filter(w => w.state === 'busy').length, maxReached:b.maxReached })),
    users:s.users.map(u => [u.hits, u.where, u.lostN]),
  }));
}
