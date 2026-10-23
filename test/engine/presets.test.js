// Os 14 cenários prontos: cada teste confere o que o texto do cenário promete ao aluno.
// Se um texto mudar (src/model/presets.js), o teste correspondente deve mudar junto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runFor } from '../helpers.js';
import { PRESETS, PRESET_BASE } from '../../src/model/presets.js';

const preset = name => { const p = PRESETS.find(x => x.name === name); assert.ok(p, `cenário "${name}" não existe`); return p; };
const fromPreset = (name, extra = {}, seed = 42) => makeSim({ ...PRESET_BASE, ...preset(name).cfg, ...extra }, seed);
const queued = s => s.backends.reduce((a, b) => a + b.apacheQ.length + b.fpmQ.length, 0);
const rate5s = s => s.stats.times.length / 5;
const code = (s, c) => s.stats.codes[c] || 0;

test('todos os 14 cenários existem, em 3 categorias', () => {
  assert.equal(PRESETS.length, 14);
  assert.deepEqual([...new Set(PRESETS.map(p => p.cat))], ['Mais comuns', 'Comuns', 'Didáticos']);
});

test('Pool saturado: fila no FPM, latência sobe; 504 só depois de ~1 min; com max_children 4 a fila some', () => {
  const s = fromPreset('Pool saturado');
  runFor(s, 60);
  assert.ok(s.backends[0].fpmQ.length >= 15 && s.stats.errors === 0, 'fila sem erros no 1º minuto');
  runFor(s, 40);
  assert.ok(code(s, '504') > 0, '504 depois de ~1 min e meio');
  const ok = fromPreset('Pool saturado', { W:4 }); runFor(ok, 60);
  assert.ok(queued(ok) < 5 && ok.stats.errors === 0);
});

test('Dependência lenta: saudável; com o banco lento vêm 504 e 503 e a vazão despenca; depois se recupera', () => {
  const p = preset('Dependência lenta'), s = fromPreset('Dependência lenta');
  runFor(s, 20);
  assert.equal(s.stats.errors, 0); assert.ok(rate5s(s) > 15);
  Object.assign(s.cfg, p.actions[0].set); runFor(s, 70);
  assert.ok(code(s, '504') > 0 && code(s, '503') > 0, JSON.stringify(s.stats.codes));
  assert.ok(rate5s(s) < 2, `vazão de sucesso ${rate5s(s)}`);
  Object.assign(s.cfg, p.actions[1].set); runFor(s, 60);
  assert.ok(rate5s(s) > 15 && queued(s) === 0, 'recuperou');
});

test('Timeout curto: 504 e vazão de sucesso perto de zero; com max_children 4 os erros somem', () => {
  const s = fromPreset('Timeout curto'); runFor(s, 60);
  assert.ok(code(s, '504') > 100);
  assert.ok(rate5s(s) < 1, `vazão ${rate5s(s)}`);
  const ok = fromPreset('Timeout curto', { W:4 }); runFor(ok, 60);
  assert.equal(ok.stats.errors, 0);
});

test('Backend cai: ~1/3 das novas dá 502 até o balanceador notar (4 s); depois os erros param', () => {
  const s = fromPreset('Backend cai (failover)');
  runFor(s, 10); s.toggleBackend(1);
  runFor(s, 4.5);
  const at = code(s, '502');
  assert.ok(at > 3, `${at} erros 502`);
  runFor(s, 10);
  assert.equal(code(s, '502'), at, 'nenhum 502 depois que o balanceador notou');
  s.toggleBackend(1); runFor(s, 5);
  assert.ok(s.backends[1].listed && s.backends[1].workers.length === 4);
});

test('Gargalo nas threads do Apache: fila no Apache, FPM ocioso; com 16 threads some', () => {
  const s = fromPreset('Gargalo nas threads do Apache'); runFor(s, 30);
  const b = s.backends[0];
  assert.ok(b.apacheQ.length > 50 && b.fpmQ.length === 0);
  assert.ok(b.workers.filter(w => w.state === 'busy').length <= 4);
  const ok = fromPreset('Gargalo nas threads do Apache', { T:16 }); runFor(ok, 30);
  assert.ok(queued(ok) < 5);
});

test('Sessões em 3 backends: perde sessões; sticky e Redis não perdem', () => {
  const s = fromPreset('Sessões em 3 backends'); runFor(s, 30);
  assert.ok(s.stats.lost > 20);
  for (const extra of [{ lb:'ip' }, { session:'redis' }]) { const t = fromPreset('Sessões em 3 backends', extra); runFor(t, 30); assert.equal(t.stats.lost, 0, JSON.stringify(extra)); }
});

test('Sticky e a queda de um backend: não perde até a queda; depois os usuários do backend caído perdem', () => {
  const s = fromPreset('Sticky e a queda de um backend'); runFor(s, 20);
  assert.equal(s.stats.lost, 0);
  s.toggleBackend(1); runFor(s, 20);
  assert.ok(s.stats.lost > 0);
});

test('Sessão no Redis: não perde; com o Redis fora responde 200 sem sessão, sem erro', () => {
  const s = fromPreset('Sessão no Redis'); runFor(s, 20);
  assert.equal(s.stats.lost, 0); assert.ok(s.redis.ops > 0);
  s.setRedis(false); runFor(s, 10);
  assert.equal(s.stats.errors, 0); assert.ok(s.stats.noSess > 10);
});

test('OPcache desligado: 0,22 s por requisição (~9 req/s) < 12 req/s → fila; ligado (~20 req/s) não', () => {
  const off = fromPreset('OPcache desligado'); runFor(off, 60);
  assert.ok(queued(off) > 50);
  assert.ok(rate5s(off) > 7 && rate5s(off) < 11, `vazão ${rate5s(off)}`);
  const on = fromPreset('OPcache desligado', { opcache:'on' }); runFor(on, 60);
  assert.ok(queued(on) < 5);
});

test('Pico no modo dynamic: começa com 2; com min_spare 1 nasce 1 worker por segundo; volta a max_spare', () => {
  const s = fromPreset('Pico no modo dynamic');
  assert.equal(s.backends[0].workers.length, 2);
  s.burst(20);
  let prev = 2;
  runFor(s, 8, x => { const n = x.backends[0].workers.length; assert.ok(n - prev <= 1, `${n - prev} de uma vez`); prev = n; });
  runFor(s, 25);
  assert.equal(s.stats.done, 20);
  assert.equal(s.backends[0].workers.length, 3, 'encolhe até max_spare (3)');
});

test('Cliente lento: prefork enche os processos e enfileira; event + FPM não forma fila', () => {
  const a = fromPreset('Cliente lento: prefork'); runFor(a, 40);
  assert.ok(a.backends[0].apacheQ.length > 30);
  const b = fromPreset('Cliente lento: event + FPM'); runFor(b, 40);
  assert.ok(queued(b) < 5);
});

test('ondemand: começa vazio, cria até max_children na rajada e some um por segundo depois do idle_timeout', () => {
  const s = fromPreset('ondemand: partida a frio');
  assert.equal(s.backends[0].workers.length, 0);
  s.burst(20); runFor(s, 4);
  assert.equal(s.backends[0].workers.length, 10);
  let prev = 10;
  runFor(s, 25, x => { const n = x.backends[0].workers.length; assert.ok(prev - n <= 1, 'mais de um removido de uma vez'); prev = n; });
  assert.equal(s.backends[0].workers.length, 0);
});

test('Escala: 500 req/s cabem em 512 workers; 750 req/s passam de 640 e dão 503', () => {
  const s = fromPreset('Escala: 512 workers'); runFor(s, 15);
  assert.equal(s.stats.errors, 0);
  s.cfg.rate = 750; runFor(s, 15);
  assert.ok(code(s, '503') > 0);
  assert.ok(rate5s(s) > 600 && rate5s(s) < 660, `vazão ${rate5s(s)} ≈ 640`);
});
