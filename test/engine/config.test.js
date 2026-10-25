// Leitura de configuração (src/engine/config.js): arquivos dos labs (test/fixtures) e casos de borda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readConfigFiles, parseIni, parseApache, toSeconds } from '../../src/engine/config.js';

const fx = name => [name, readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')];
const read = (...files) => readConfigFiles(files.map(f => typeof f === 'string' ? fx(f) : f));

test('lab 03 (www.conf ondemand): pm, max_children e idle_timeout com sufixo "s"', () => {
  const r = read('lab03-www.conf');
  assert.deepEqual(r.changes, { pm:'ondemand', W:10, idleTimeout:10 });
  assert.deepEqual(r.skipped, ['pm.status_path']);
});

test('lab 04: opcache.enable=1 → ligado; =0 → desligado; outras chaves opcache.* reconhecidas e não simuladas', () => {
  const on = read('lab04-on.ini'), off = read('lab04-off.ini');
  assert.equal(on.changes.opcache, 'on'); assert.equal(off.changes.opcache, 'off');
  assert.deepEqual(on.skipped.sort(), ['opcache.max_accelerated_files', 'opcache.memory_consumption', 'opcache.validate_timestamps']);
});

test('lab 05: prefork → arquitetura A com MaxRequestWorkers; httpd.conf com event → B', () => {
  assert.deepEqual(read('lab05-mpm_prefork.conf').changes, { arch:'A', T:10 });
  assert.deepEqual(read('lab05-httpd-event.conf').changes, { arch:'B', T:100 });
  assert.deepEqual(read('lab05-fpm.conf').changes, { pm:'static', W:10 });
});

const MPM_CONF = `<IfModule mpm_prefork_module>\n  MaxRequestWorkers 250\n</IfModule>\n<IfModule mpm_event_module>\n  ThreadsPerChild 25\n  MaxRequestWorkers 400\n</IfModule>\n`;

test('httpd-mpm.conf com vários blocos: sem LoadModule usa o primeiro e avisa', () => {
  const r = read(['httpd-mpm.conf', MPM_CONF]);
  assert.deepEqual(r.changes, { arch:'A', T:256 }, '250 não existe no controle; usa o mais próximo');
  assert.match(r.notes.join(), /vários MPMs/);
});

test('httpd-mpm.conf + httpd.conf com LoadModule do event: usa o bloco do event', () => {
  const r = read(['httpd.conf', '#LoadModule mpm_prefork_module x\nLoadModule mpm_event_module modules/mod_mpm_event.so\n'], ['httpd-mpm.conf', MPM_CONF]);
  assert.equal(r.changes.arch, 'B'); assert.equal(r.changes.T, 400);
  assert.equal(r.notes.filter(n => /vários MPMs/.test(n)).length, 0);
});

test('LoadModule comentado é ignorado', () => {
  assert.equal(parseApache('#LoadModule mpm_prefork_module x\n'), null);
});

test('ServerLimit × ThreadsPerChild quando não há MaxRequestWorkers', () => {
  const r = read(['mpm_event.conf', '<IfModule mpm_event_module>\n ServerLimit 4\n ThreadsPerChild 25\n</IfModule>\n']);
  assert.equal(r.changes.T, 100);
});

test('valor sem controle exato usa o mais próximo e avisa', () => {
  const r = read(['www.conf', '[www]\npm = static\npm.max_children = 7\n']);
  assert.equal(r.changes.W, 6);
  assert.match(r.applied.join(), /o controle não tem 7/);
});

test('vários pools: usa o primeiro e avisa; php_admin_value[...] e comentários no fim da linha', () => {
  const r = read(['pools.conf', 'pm = dynamic\npm.max_children = 50 ; comentario\npm.start_servers=5\nphp_admin_value[opcache.enable] = 0\nsession.save_handler = redis\nmemory_limit=128M\n[pool2]\npm=static\n']);
  assert.deepEqual(r.changes, { pm:'dynamic', W:50, start:5, opcache:'off', session:'redis' });
  assert.deepEqual(r.skipped, ['memory_limit']);
  assert.match(r.notes.join(), /2 pools/);
});

test('session.save_handler: files → arquivo; memcached → compartilhado com aviso; outro → não simulado', () => {
  assert.equal(read(['a.ini', 'session.save_handler = files']).changes.session, 'file');
  const m = read(['b.ini', 'session.save_handler = memcached']);
  assert.equal(m.changes.session, 'redis'); assert.match(m.notes.join(), /memcached/);
  const u = read(['c.ini', 'session.save_handler = user']);
  assert.equal(u.changes.session, undefined); assert.match(u.notes.join(), /não é simulado/);
});

test('arquivo sem nada reconhecível avisa', () => {
  const r = read(['lixo.txt', 'olá mundo']);
  assert.deepEqual(r.changes, {});
  assert.match(r.notes.join(), /não encontrei/);
});

test('parseIni: seções, aspas e comentários', () => {
  const s = parseIni('; c\n# c\na = "x"\n[www]\nb = 2 ; fim\n');
  assert.deepEqual(s.map(x => [x.name, x.kv]), [['', { a:'x' }], ['www', { b:'2' }]]);
});

test('toSeconds: sufixos do php-fpm (s, m, h, d)', () => {
  assert.deepEqual(['10', '10s', '2m', '1h', '1d', 'x'].map(toSeconds), [10, 10, 120, 3600, 86400, null]);
});

test('my.cnf: max-connections (com hífen) e innodb_lock_wait_timeout ligam o MySQL; outras chaves reconhecidas', () => {
  const r = read('my.cnf');
  assert.deepEqual(r.changes, { db:'mysql', dbMaxConn:300, lockWait:10 });
  assert.deepEqual(r.skipped.sort(), ['innodb_buffer_pool_size', 'long_query_time', 'wait_timeout']);
});

test('my.cnf: valores fora do controle viram o mais próximo, com aviso', () => {
  const r = read(['x.cnf', '[mysqld]\nmax_connections = 160\ninnodb_lock_wait_timeout = 3600\n']);
  assert.equal(r.changes.dbMaxConn, 151); assert.equal(r.changes.lockWait, 120);
  assert.match(r.applied.join(), /não tem 3600/);
});
