// Regras do percurso da requisição (src/engine/sim.js): Apache, timeouts, balanceador, sessões, OPcache, cliente lento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runFor, DT } from '../helpers.js';
import { BACKLOG, HOP, SEND, BACK, OPCACHE_COST } from '../../src/engine/sim.js';

const PATH = 2 * HOP + SEND + BACK; // 510 ms de percurso fixo
const quiet = { rate:0 };            // sem chegadas automáticas: as requisições vêm de burst()/spawnReq()
const lastLat = s => s.stats.lat[s.stats.lat.length - 1];

test('latência = percurso fixo + PHP (±15%) + OPcache frio na 1ª requisição do backend', () => {
  const s = makeSim({ ...quiet, exec:1000 });
  s.spawnReq(); runFor(s, 4);
  const first = lastLat(s);
  assert.ok(first >= PATH + 850 + OPCACHE_COST && first <= PATH + 1150 + OPCACHE_COST + 5 * DT, `1ª: ${first}`);
  s.spawnReq(); runFor(s, 4);
  const second = lastLat(s);
  assert.ok(second >= PATH + 850 && second <= PATH + 1150 + 5 * DT, `2ª (OPcache quente): ${second}`);
});

test('OPcache desligado custa +120 ms em toda requisição', () => {
  const on = makeSim({ ...quiet, exec:500 }, 7), off = makeSim({ ...quiet, exec:500, opcache:'off' }, 7);
  for (const s of [on, off]) { s.spawnReq(); runFor(s, 3); s.spawnReq(); runFor(s, 3); }
  const d = lastLat(off) - lastLat(on);
  assert.ok(Math.abs(d - OPCACHE_COST) <= 2 * DT, `diferença ${d} ms`);
});

for (const arch of ['B', 'A']) {
  test(`arquitetura ${arch}: passou do backlog (${BACKLOG}) na fila do Apache → 503`, () => {
    const s = makeSim({ ...quiet, arch, T:1, W:1, exec:3000, timeout:120 });
    s.burst(BACKLOG + 4); runFor(s, 1);
    assert.equal(s.backends[0].apacheQ.length, BACKLOG);
    assert.equal(s.stats.codes['503'], 3);
  });
}

test('504: por espera na fila e por terminar o PHP depois do timeout', () => {
  const s = makeSim({ ...quiet, T:5, W:1, exec:10000, timeout:5 });
  s.burst(3);
  runFor(s, 5.6);
  assert.equal(s.stats.codes['504'], 2, 'as duas da fila expiram sem chegar a um worker');
  runFor(s, 7);
  assert.equal(s.stats.codes['504'], 3, 'a que executava termina depois do timeout e também vira 504');
  assert.equal(s.stats.done, 0);
});

test('o menor limite manda: com T < max_children, no máximo T scripts rodam ao mesmo tempo', () => {
  const s = makeSim({ T:3, W:16, exec:800, rate:20 });
  runFor(s, 10, x => assert.ok(x.backends[0].workers.filter(w => w.state === 'busy').length <= 3));
  assert.ok(s.backends[0].apacheQ.length > 20, 'a fila forma no Apache');
});

test('balanceador round-robin distribui em rodízio', () => {
  const s = makeSim({ ...quiet, nb:3 });
  s.burst(9); runFor(s, 0.2);
  const per = [0, 1, 2].map(i => s.reqs.filter(r => r.b === i).length);
  assert.deepEqual(per, [3, 3, 3]);
});

test('balanceador sticky: o mesmo usuário vai sempre ao mesmo backend (id % n)', () => {
  const s = makeSim({ nb:3, lb:'ip', rate:20 });
  runFor(s, 5, x => { for (const r of x.reqs) if (r.b >= 0) assert.equal(r.b, r.u.id % 3); });
  assert.equal(s.stats.lost, 0);
});

test('balanceador menos conexões: escolhe o backend menos ocupado', () => {
  const s = makeSim({ ...quiet, nb:2, lb:'lc', exec:5000 });
  s.spawnReq(); runFor(s, 0.3);
  s.spawnReq(); runFor(s, 0.3);
  assert.deepEqual(s.reqs.map(r => r.b), [0, 1]);
});

test('detecção de queda: até "detect" segundos o balanceador ainda manda ao backend morto (502); depois para', () => {
  const s = makeSim({ ...quiet, nb:2, detect:4 });
  s.toggleBackend(1);
  runFor(s, 1); s.burst(4); runFor(s, 1);
  assert.equal(s.stats.codes['502'], 2, 'metade das 4 foi ao backend morto');
  runFor(s, 3);
  assert.equal(s.backends[1].listed, false);
  s.burst(4); runFor(s, 1);
  assert.equal(s.stats.codes['502'], 2, 'depois de notar, nenhuma nova vai ao morto');
  s.toggleBackend(1);
  assert.equal(s.backends[1].listed, false, 'a volta também leva "detect" segundos');
  runFor(s, 4.1);
  assert.equal(s.backends[1].listed, true);
});

test('detect = 0: o balanceador nota na hora; sem backend nenhum → 502/503', () => {
  const s = makeSim({ ...quiet, nb:1, detect:0 });
  s.toggleBackend(0); s.burst(3); runFor(s, 1);
  assert.equal(s.stats.codes['502/503'], 3);
});

for (const arch of ['A', 'B']) {
  test(`arquitetura ${arch}: derrubar o backend falha (502) as requisições em execução e em envio`, () => {
    const s = makeSim({ ...quiet, arch, T:10, W:10, exec:300, slowPct:100, slowMs:5000 });
    s.burst(2); runFor(s, 0.9);   // estas já estão enviando ao cliente lento
    s.burst(2); runFor(s, 0.4);   // estas estão executando o PHP
    assert.deepEqual(s.reqs.map(r => r.stage).sort(), ['exec', 'exec', 'send', 'send']);
    s.toggleBackend(0);
    assert.equal(s.stats.codes['502'], 4);
  });
}

test('cliente lento: no prefork (A) o processo fica preso durante o envio; no event+FPM (B) não', () => {
  const lat2 = arch => {
    const s = makeSim({ ...quiet, arch, T:1, W:1, exec:100, slowPct:100, slowMs:3000 });
    s.burst(2); runFor(s, 10);
    return Math.max(...s.stats.lat);
  };
  assert.ok(lat2('A') > 3000 * 2, `A: ${lat2('A')} ms (a 2ª espera o envio da 1ª)`);
  assert.ok(lat2('B') < 3000 + 1500, `B: ${lat2('B')} ms (o envio não segura nada)`);
});

test('sessão em arquivo: trocar de backend perde a sessão; sticky não perde', () => {
  const rr = makeSim({ nb:3, session:'file', rate:10 }); runFor(rr, 20);
  assert.ok(rr.stats.lost > 10, `round-robin perdeu ${rr.stats.lost}`);
  assert.equal(rr.stats.lost, rr.users.reduce((a, u) => a + u.lostN, 0), 'soma por usuário = total');
  const ip = makeSim({ nb:3, session:'file', rate:10, lb:'ip' }); runFor(ip, 20);
  assert.equal(ip.stats.lost, 0);
});

test('sessão no Redis: não se perde ao trocar de backend; 2 acessos por requisição', () => {
  const s = makeSim({ nb:3, session:'redis', rate:10, exec:200 }); runFor(s, 20);
  assert.equal(s.stats.lost, 0);
  const executed = s.users.reduce((a, u) => a + u.hits, 0);
  assert.equal(s.redis.ops, 2 * executed);
  assert.ok(s.users.every(u => u.hits === 0 || u.where === 'redis'));
});

test('Redis fora (PHP puro): resposta 200 sem sessão, sem erro; os dados voltam quando o Redis volta', () => {
  const s = makeSim({ nb:2, session:'redis', rate:10, exec:200 });
  runFor(s, 5);
  const hits = s.users.map(u => u.hits);
  s.setRedis(false); runFor(s, 5);
  assert.equal(s.stats.errors, 0);
  assert.ok(s.stats.noSess > 20, `${s.stats.noSess} respostas sem sessão`);
  assert.deepEqual(s.users.map(u => u.hits), hits, 'nada é gravado nem apagado durante a queda');
  s.setRedis(true); runFor(s, 5);
  assert.ok(s.users.some(u => u.last && u.last.kind === 'ok'), 'sessão encontrada de novo');
  assert.ok(s.users.every((u, i) => u.hits >= hits[i]), 'os contadores continuam de onde pararam');
});
