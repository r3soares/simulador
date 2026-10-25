// Regras do MySQL: conexões, max_connections, persistentes, fila de núcleos, lock e queda.
// Fontes em docs/referencias.md §10 (MySQL) e §1 (PDO/mysqli).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runFor, DT } from '../helpers.js';
import { createSim } from '../../src/engine/sim.js';
import { mulberry32 } from '../../src/engine/rng.js';
import { DEFAULTS } from '../../src/model/params.js';
import { createChecker } from '../invariants.js';

const MY = { db:'mysql', T:20, W:8, pm:'static', exec:100, dbQ:2, dbMs:10, dbCores:4, dbMaxConn:151, dbPersist:'off', lockWait:50 };
const mk = (over = {}, seed = 3) => makeSim({ ...MY, ...over }, seed);
const code = (s, c) => s.stats.codes[c] || 0;
const busy = s => s.backends.reduce((a, b) => a + b.workers.filter(w => w.state === 'busy').length, 0);

test('sem banco: nada do MySQL é tocado', () => {
  const s = makeSim({ rate:20 }, 1); runFor(s, 10);
  assert.equal(s.db.ops, 0); assert.equal(s.db.maxUsed, 0);
  assert.deepEqual(s.stats.dbErr, { '1040':0, '2002':0, '1205':0, '2013':0 });
});

test('a requisição soma o tempo das consultas (consultas × tempo) à latência', () => {
  const base = mk({ dbQ:1, dbMs:1, rate:2 }), heavy = mk({ dbQ:50, dbMs:10, rate:2 });
  runFor(base, 30); runFor(heavy, 30);
  const avg = s => s.stats.lat.reduce((a, b) => a + b, 0) / s.stats.lat.length;
  const diff = avg(heavy) - avg(base);
  assert.ok(diff > 420 && diff < 580, `diferença ${diff} ms ≈ 500 ms`);
});

test('não persistente: a conexão só existe durante o script e é solta ao terminar', () => {
  const s = mk({ rate:0 }); s.burst(3); runFor(s, 0.3); // chegou ao backend aos 240 ms; o PHP está rodando
  assert.equal(s.db.conns, 3);
  runFor(s, 3);
  assert.equal(s.db.conns, 0); assert.equal(s.db.maxUsed, 3); assert.equal(s.stats.done, 3);
});

test('max_connections: acima do limite a conexão é recusada (1040) e a resposta é 500, sem prender o worker', () => {
  const s = mk({ dbMaxConn:5, W:20, dbMs:500, rate:0 }); s.burst(20); runFor(s, 0.6);
  assert.equal(s.db.conns, 5);
  assert.equal(s.stats.dbErr['1040'], 15); assert.equal(code(s, '500'), 15);
  assert.equal(busy(s), 5, 'só os 5 com conexão continuam ocupando worker');
});

test('persistente: cada worker usado segura uma conexão mesmo ocioso; o worker sem conexão recebe 1040', () => {
  const s = mk({ dbPersist:'on', W:10, dbMaxConn:6, dbMs:200, rate:0 }); s.burst(10); runFor(s, 5);
  assert.equal(s.db.conns, 6, 'conexões continuam abertas depois que tudo terminou');
  assert.equal(s.stats.dbErr['1040'], 4);
  assert.equal(s.backends[0].workers.filter(w => w.conn).length, 6);
  const off = mk({ W:10, dbMaxConn:6, dbMs:200, rate:0 }); off.burst(10); runFor(off, 5);
  assert.equal(off.db.conns, 0);
});

test('persistente: worker removido (dynamic) e backend derrubado soltam a conexão', () => {
  const s = mk({ dbPersist:'on', pm:'dynamic', W:10, start:8, minSpare:1, maxSpare:2, rate:0 }); s.burst(8); runFor(s, 2);
  assert.ok(s.db.conns >= 5); assert.equal(s.db.conns, s.backends[0].workers.filter(w => w.conn).length);
  runFor(s, 10);
  assert.equal(s.backends[0].workers.length, 2); assert.ok(s.db.conns <= 2);
  const t = mk({ dbPersist:'on', nb:2, rate:0 }); t.burst(8); runFor(t, 2);
  const before = t.db.conns, mine = t.backends[0].workers.filter(w => w.conn).length;
  t.toggleBackend(0); assert.equal(t.db.conns, before - mine);
});

test('persistente no prefork: a conexão fica com o processo', () => {
  const s = mk({ arch:'A', T:6, dbPersist:'on', rate:0 }); s.burst(6); runFor(s, 3);
  assert.equal(s.db.conns, 6); assert.equal(s.backends[0].procConn.filter(Boolean).length, 6);
});

test('núcleos: vazão limitada a núcleos / (consultas × tempo), com fila dentro do MySQL', () => {
  const s = mk({ W:40, T:100, dbQ:4, dbMs:25, dbCores:2, rate:30 }); runFor(s, 30);
  const rate = s.stats.times.length / 5;
  assert.ok(rate > 17 && rate < 23, `vazão ${rate} ≈ 20 req/s`);
  assert.ok(s.db.queue.length > 10); assert.equal(s.db.active.length, 2);
});

test('MySQL fora: conexão recusada (2002) na hora; quem estava no banco perde a conexão (2013)', () => {
  const s = mk({ dbMs:400, rate:10 }); runFor(s, 3);
  const inDb = s.db.active.length + s.db.queue.length;
  assert.ok(inDb > 0);
  s.setDb(false);
  assert.equal(s.stats.dbErr['2013'], inDb); assert.equal(s.db.conns, 0);
  runFor(s, 5);
  assert.ok(s.stats.dbErr['2002'] > 20); assert.equal(busy(s), 0, 'falha rápida: nenhum worker preso');
  assert.equal(code(s, '504'), 0);
  s.setDb(true); const done = s.stats.done; runFor(s, 5);
  assert.ok(s.stats.done > done);
});

test('MySQL fora derruba também as conexões persistentes ociosas', () => {
  const s = mk({ dbPersist:'on', rate:0 }); s.burst(8); runFor(s, 3);
  assert.equal(s.db.conns, 8);
  s.setDb(false); assert.equal(s.db.conns, 0); assert.ok(s.backends[0].workers.every(w => !w.conn));
});

test('lock: escrita espera até innodb_lock_wait_timeout e recebe 1205 (500)', () => {
  const s = mk({ lockWait:5, timeout:30, rate:0 }); s.setDbLock(true); s.burst(4);
  runFor(s, 4); assert.equal(s.db.lockQ.length, 4); assert.equal(s.stats.errors, 0);
  runFor(s, 2); assert.equal(s.stats.dbErr['1205'], 4); assert.equal(code(s, '500'), 4);
  assert.equal(busy(s), 0);
});

test('lock mais longo que o timeout web: 504 no timeout, mas o worker e a conexão continuam presos (fantasma)', () => {
  const s = mk({ lockWait:50, timeout:10, rate:0 }); s.setDbLock(true); s.burst(4);
  runFor(s, 11);
  assert.equal(code(s, '504'), 4, 'o cliente recebe 504 aos 10 s');
  assert.equal(s.reqs.filter(r => r.ghost).length, 4);
  assert.equal(busy(s), 4, 'workers continuam esperando o banco'); assert.equal(s.db.conns, 4);
  assert.equal(s.backends[0].thrBusy, 0, 'o Apache já liberou as threads');
  runFor(s, 40);
  assert.equal(busy(s), 0); assert.equal(s.db.conns, 0);
  assert.equal(s.stats.dbErr['1205'], 4, 'o 1205 acontece (log do PHP)');
  assert.equal(code(s, '500'), 0, 'mas não vira outra resposta: o cliente já recebeu 504');
  assert.equal(s.stats.errors, 4);
});

test('destravar: quem esperava o lock segue para o banco e termina', () => {
  const s = mk({ rate:0 }); s.setDbLock(true); s.burst(5); runFor(s, 3);
  s.setDbLock(false); runFor(s, 3);
  assert.equal(s.stats.done, 5); assert.equal(s.stats.errors, 0);
});

test('backend derrubado com fantasmas: somem sem contar outro erro', () => {
  const s = mk({ timeout:5, rate:0 }); s.setDbLock(true); s.burst(4); runFor(s, 6);
  assert.equal(s.reqs.filter(r => r.ghost).length, 4);
  s.toggleBackend(0); runFor(s, 1);
  assert.equal(s.stats.errors, 4); assert.equal(s.db.conns, 0); assert.equal(s.db.lockQ.length, 0);
});

test('padrão da página: sessão no Redis e MySQL ligados, sem erros e respeitando as invariantes', () => {
  assert.equal(DEFAULTS.session, 'redis'); assert.equal(DEFAULTS.db, 'mysql');
  const s = createSim({ ...DEFAULTS }, { rng:mulberry32(11) }); s.reset();
  const check = createChecker(s.cfg);
  for (let i = 0; i < 30000 / DT; i++) { s.step(DT); check(s); }
  assert.equal(s.stats.errors, 0); assert.ok(s.stats.done > 50);
  assert.ok(s.redis.ops > 0 && s.db.ops > 0 && s.db.maxUsed > 0);
});
