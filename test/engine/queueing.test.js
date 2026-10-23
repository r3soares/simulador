// Coerência com a teoria de filas: vazão ≈ min(chegadas, capacidade) e latência ≈ percurso + PHP quando há folga.
// capacidade (req/s) = workers / duração do PHP (s). Tolerâncias largas: as chegadas são aleatórias (Poisson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runFor } from '../helpers.js';
import { HOP, SEND, BACK } from '../../src/engine/sim.js';

const PATH = 2 * HOP + SEND + BACK;
const throughput = (s, secs) => { const t0 = s.stats.done; runFor(s, secs); return (s.stats.done - t0) / secs; };

const CASES = [
  // [nome, cfg, vazão esperada]
  ['com folga (25% de uso)', { W:8, T:20, exec:400, rate:5 }, 5],
  ['saturado: 2 workers × 0,8 s = 2,5 req/s', { W:2, T:20, exec:800, rate:4, timeout:120 }, 2.5],
  ['saturado no Apache: 4 threads × 0,8 s = 5 req/s', { W:16, T:4, exec:800, rate:8, timeout:120 }, 5],
  ['prefork com folga (6 processos × 0,1 s = 60 req/s de capacidade)', { arch:'A', T:6, exec:100, rate:30 }, 30],
  ['3 backends somam a capacidade', { nb:3, W:2, T:20, exec:500, rate:20, timeout:120 }, 12],
];

for (const [name, cfg, expected] of CASES) {
  test(`vazão: ${name}`, () => {
    const s = makeSim(cfg, 99);
    runFor(s, 20); // aquecimento: forma a fila / estabiliza
    const x = throughput(s, 60);
    assert.ok(Math.abs(x - expected) / expected < 0.12, `vazão ${x.toFixed(2)} req/s, esperado ≈ ${expected}`);
  });
}

test('latência com folga ≈ percurso fixo + duração média do PHP', () => {
  const s = makeSim({ W:8, T:20, exec:400, rate:5 }, 3);
  runFor(s, 60);
  const l = s.stats.lat, avg = l.reduce((a, b) => a + b, 0) / l.length;
  assert.ok(avg > PATH + 400 && avg < PATH + 400 + 80, `média ${avg.toFixed(0)} ms`);
});

test('saturado: a fila cresce na taxa (chegadas − capacidade)', () => {
  const s = makeSim({ W:2, T:600, exec:800, rate:4, timeout:300 }, 5);
  runFor(s, 10);
  const q0 = s.backends[0].fpmQ.length;
  // 100 s: o desvio da taxa de chegada medida é ≈ √(4·100)/100 = 0,2 req/s
  runFor(s, 100);
  const growth = (s.backends[0].fpmQ.length - q0) / 100;
  assert.ok(Math.abs(growth - 1.5) < 0.45, `fila cresce ${growth.toFixed(2)} req/s, esperado ≈ 1,5`);
});
