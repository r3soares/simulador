// Regras de gerência de workers do PHP-FPM (src/engine/fpm.js), comparadas com php-src fpm_process_ctl.c.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintain, initWorkers, HEARTBEAT, MAX_SPAWN_RATE, ONDEMAND_START } from '../../src/engine/fpm.js';
import { DEFAULTS } from '../../src/model/params.js';

const backend = () => ({ i:0, up:true, workers:[], fpmQ:[], pmTimer:0, spawnN:1, maxReached:0, atMax:false });
const busyAll = b => b.workers.forEach(w => { w.state = 'busy'; w.req = {}; });
const noExec = () => {};
// avança um heartbeat (1 s) de uma vez
const beat = (b, cfg, T) => maintain(b, HEARTBEAT, cfg, T, noExec);

test('static: cria max_children workers na partida e nunca muda', () => {
  const cfg = { ...DEFAULTS, pm:'static', W:7 }, b = backend();
  initWorkers(b, cfg, 0);
  assert.equal(b.workers.length, 7);
  busyAll(b);
  for (let s = 1; s <= 5; s++) beat(b, cfg, s * 1000);
  assert.equal(b.workers.length, 7);
  assert.equal(b.maxReached, 0, 'em static o contador "max children reached" fica em 0');
});

test('dynamic: começa com min(start_servers, max_children)', () => {
  const b = backend();
  initWorkers(b, { ...DEFAULTS, pm:'dynamic', start:5, W:3 }, 0);
  assert.equal(b.workers.length, 3);
});

test(`dynamic: taxa de criação dobra a cada segundo com déficit, até ${MAX_SPAWN_RATE}`, () => {
  const cfg = { ...DEFAULTS, pm:'dynamic', start:1, W:1000, minSpare:1000, maxSpare:1000 }, b = backend();
  initWorkers(b, cfg, 0); busyAll(b);
  const created = [];
  for (let s = 1; s <= 8; s++) { const before = b.workers.length; beat(b, cfg, s * 1000); created.push(b.workers.length - before); busyAll(b); }
  assert.deepEqual(created, [1, 2, 4, 8, 16, 32, 32, 32]);
});

test('dynamic: cria no máximo min_spare − ociosos por segundo', () => {
  const cfg = { ...DEFAULTS, pm:'dynamic', start:1, W:50, minSpare:3, maxSpare:10 }, b = backend();
  initWorkers(b, cfg, 0); busyAll(b);
  const created = [];
  for (let s = 1; s <= 4; s++) { const before = b.workers.length; beat(b, cfg, s * 1000); created.push(b.workers.length - before); busyAll(b); }
  assert.deepEqual(created, [1, 2, 3, 3], 'a taxa dobra (1, 2, 4…), mas o déficit limita a 3');
});

test('dynamic: com min_spare = 1 nasce 1 worker por segundo', () => {
  const cfg = { ...DEFAULTS, pm:'dynamic', start:2, W:10, minSpare:1, maxSpare:3 }, b = backend();
  initWorkers(b, cfg, 0); busyAll(b);
  for (let s = 1; s <= 5; s++) { const before = b.workers.length; beat(b, cfg, s * 1000); assert.equal(b.workers.length - before, 1); busyAll(b); }
});

test('dynamic: nunca passa de max_children, conta o limite uma vez por episódio e volta a taxa a 1', () => {
  // W = 3: no 2º segundo a taxa (2) é maior que a folga (1); o FPM cria só 1
  const cfg = { ...DEFAULTS, pm:'dynamic', start:1, W:3, minSpare:6, maxSpare:8 }, b = backend();
  initWorkers(b, cfg, 0); busyAll(b);
  for (let s = 1; s <= 6; s++) { beat(b, cfg, s * 1000); busyAll(b); assert.ok(b.workers.length <= 3, `${b.workers.length} workers > max_children`); }
  assert.equal(b.workers.length, 3);
  assert.equal(b.maxReached, 1, 'conta uma vez enquanto o limite continua atingido');
  assert.equal(b.spawnN, 1);
  b.workers.forEach(w => { w.state = 'idle'; w.req = null; }); beat(b, { ...cfg, minSpare:1 }, 7000); // sai do episódio
  busyAll(b); beat(b, cfg, 8000);
  assert.equal(b.maxReached, 2, 'novo episódio conta de novo');
});

test('dynamic: acima de max_spare remove um ocioso por segundo (o ocioso há mais tempo)', () => {
  const cfg = { ...DEFAULTS, pm:'dynamic', start:8, W:8, minSpare:1, maxSpare:3 }, b = backend();
  initWorkers(b, cfg, 0);
  b.workers.forEach((w, i) => { w.idleSince = 100 * i; });
  const oldest = b.workers[0];
  beat(b, cfg, 1000);
  assert.equal(b.workers.length, 7);
  assert.ok(!b.workers.includes(oldest));
  for (let s = 2; s <= 10; s++) beat(b, cfg, s * 1000);
  assert.equal(b.workers.length, 3, 'para em max_spare');
});

test('ondemand: começa vazio, cria sob demanda com custo de partida e entrega a fila', () => {
  const cfg = { ...DEFAULTS, pm:'ondemand', W:3 }, b = backend(), started = [];
  initWorkers(b, cfg, 0);
  assert.equal(b.workers.length, 0);
  b.fpmQ.push({ id:1 }, { id:2 }, { id:3 }, { id:4 }, { id:5 });
  maintain(b, 16, cfg, 16, r => started.push(r.id));
  assert.equal(b.workers.length, 3, 'limitado a max_children');
  assert.ok(b.workers.every(w => w.state === 'starting'));
  assert.equal(b.maxReached, 1);
  maintain(b, ONDEMAND_START, cfg, 16 + ONDEMAND_START, r => started.push(r.id));
  assert.deepEqual(started, [1, 2, 3], 'depois da partida, cada worker pega uma requisição em ordem');
});

test('ondemand: remove no máximo um worker ocioso por segundo após process_idle_timeout', () => {
  const cfg = { ...DEFAULTS, pm:'ondemand', W:5, idleTimeout:2 }, b = backend();
  for (let i = 0; i < 5; i++) b.workers.push({ state:'idle', req:null, idleSince:0 });
  const counts = [];
  for (let s = 1; s <= 8; s++) { beat(b, cfg, s * 1000); counts.push(b.workers.length); }
  assert.deepEqual(counts, [5, 5, 4, 3, 2, 1, 0, 0]);
});

test('backend fora do ar ou arquitetura A: nada acontece', () => {
  const cfg = { ...DEFAULTS, pm:'dynamic', start:1, W:10, minSpare:5 }, b = backend();
  initWorkers(b, cfg, 0); b.up = false; beat(b, cfg, 1000);
  assert.equal(b.workers.length, 1);
  const a = backend(); initWorkers(a, { ...cfg, arch:'A' }, 0);
  assert.equal(a.workers.length, 0);
});
