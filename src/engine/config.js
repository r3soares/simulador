// Leitura de arquivos de configuração reais (php.ini, pool do FPM, Apache, my.cnf do MySQL).
// Puro: não altera a simulação; devolve em rep.changes os valores a aplicar e, em rep, o relatório.
import { PARAMS, idxOf } from '../model/params.js';

const NAMES = { arch:'arquitetura', T:'threads/processos do Apache', pm:'pm', W:'max_children', start:'start_servers', minSpare:'min_spare_servers', maxSpare:'max_spare_servers', idleTimeout:'process_idle_timeout', opcache:'OPcache', session:'sessão', db:'banco', dbMaxConn:'max_connections', lockWait:'innodb_lock_wait_timeout' };
const NOT_SIMULATED = ['memory_limit', 'max_execution_time', 'request_terminate_timeout', 'listen.backlog', 'pm.max_requests', 'pm.status_path', 'opcache.memory_consumption', 'opcache.validate_timestamps', 'opcache.jit', 'opcache.max_accelerated_files',
  'mysqli.allow_persistent', 'mysqli.max_persistent', 'wait_timeout', 'max_user_connections', 'innodb_buffer_pool_size', 'thread_cache_size', 'long_query_time', 'innodb_thread_concurrency', 'back_log', 'lock_wait_timeout'];
export function parseIni(text) {
  const secs = [{ name:'', kv:{} }]; let cur = secs[0];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    const m = line.match(/^\[([^\]]+)\]$/);
    if (m) { cur = { name:m[1], kv:{} }; secs.push(cur); continue; }
    const eq = line.indexOf('='); if (eq < 0) continue;
    let key = line.slice(0, eq).trim().toLowerCase(), val = line.slice(eq + 1).replace(/\s+;.*$/, '').trim().replace(/^["']|["']$/g, '');
    const arr = key.match(/^php(?:_admin)?_(?:value|flag)\[(.+)\]$/); if (arr) key = arr[1];
    cur.kv[key] = val;
  }
  return secs;
}
export const LOADED_MPM = /^\s*LoadModule\s+mpm_(\w+)_module/im;
// hint: MPM do LoadModule achado em outro arquivo enviado junto (ex.: httpd.conf + extra/httpd-mpm.conf)
export function parseApache(text, hint) {
  text = text.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
  const blocks = [...text.matchAll(/<IfModule\s+mpm_(\w+)_module>([\s\S]*?)<\/IfModule>/gi)];
  const own = text.match(LOADED_MPM), loaded = own ? own[1].toLowerCase() : hint || null;
  // httpd-mpm.conf traz um bloco por MPM: usa o do MPM carregado, se houver; senão o primeiro
  const mpm = loaded || (blocks.length ? blocks[0][1].toLowerCase() : null);
  const blk = blocks.find(m => m[1].toLowerCase() === mpm) || (loaded ? null : blocks[0]);
  const scope = blk ? blk[2] : text.replace(/<IfModule\s+mpm_\w+_module>[\s\S]*?<\/IfModule>/gi, '');
  const num = re => { const m = scope.match(re); return m ? +m[1] : null; };
  const maxW = num(/^\s*(?:MaxRequestWorkers|MaxClients)\s+(\d+)/im), tpc = num(/^\s*ThreadsPerChild\s+(\d+)/im), sl = num(/^\s*ServerLimit\s+(\d+)/im);
  if (maxW === null && tpc === null && sl === null && !own && !blocks.length) return null;
  return { mpm, maxW, tpc, sl, guessed: !loaded && blocks.length > 1 };
}
export const toSeconds = v => { const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/i); if (!m) return null; return +m[1] * ({ '': 1, s:1, m:60, h:3600, d:86400 }[m[2].toLowerCase()]); };
export const isOff = v => /^(0|off|false|no|none)$/i.test(String(v).trim());
export function newReport() { return { applied:[], skipped:[], notes:[], changes:{} }; }
function setCfg(key, value, source, rep) {
  const p = PARAMS.find(x => x.k === key); let v = value;
  if (p && p.vals) v = p.vals[idxOf(p.vals, value)]; else if (p && p.min !== undefined) v = Math.min(p.max, Math.max(p.min, value));
  rep.changes[key] = v;
  rep.applied.push(`${source} → ${NAMES[key] || key} = ${v}` + (typeof value === 'number' && v !== value ? ` (o controle não tem ${value}; usei o valor mais próximo)` : ''));
}
export function applyConfigText(name, text, rep) {
  const secs = parseIni(text), flat = Object.assign({}, ...secs.map(x => x.kv));
  const pools = secs.filter(x => 'pm' in x.kv || Object.keys(x.kv).some(k => k.startsWith('pm.')));
  const pk = pools.length ? Object.assign({}, flat, pools[0].kv) : flat;
  if (pools.length > 1) rep.notes.push(`${name}: há ${pools.length} pools; usei o primeiro (${pools[0].name ? '[' + pools[0].name + ']' : 'o que vem antes de qualquer [seção]'}).`);
  let found = 0;
  const get = k => k in pk ? pk[k] : undefined;
  if (get('pm') !== undefined) { found++; const v = get('pm').toLowerCase(); if (['static', 'dynamic', 'ondemand'].includes(v)) setCfg('pm', v, `${name}: pm`, rep); else rep.notes.push(`${name}: pm = ${v} não é suportado.`); }
  const nums = [['pm.max_children', 'W'], ['pm.start_servers', 'start'], ['pm.min_spare_servers', 'minSpare'], ['pm.max_spare_servers', 'maxSpare']];
  for (const [k, key] of nums) if (get(k) !== undefined && !isNaN(+get(k))) { found++; setCfg(key, +get(k), `${name}: ${k}`, rep); }
  if (get('pm.process_idle_timeout') !== undefined) { found++; const sec = toSeconds(get('pm.process_idle_timeout')); if (sec !== null) setCfg('idleTimeout', sec, `${name}: pm.process_idle_timeout`, rep); }
  if (get('opcache.enable') !== undefined) { found++; setCfg('opcache', isOff(get('opcache.enable')) ? 'off' : 'on', `${name}: opcache.enable`, rep); }
  if (get('session.save_handler') !== undefined) {
    found++; const h = get('session.save_handler').toLowerCase();
    if (h === 'files') setCfg('session', 'file', `${name}: session.save_handler`, rep);
    else if (h === 'redis' || h === 'memcached' || h === 'memcache') { setCfg('session', 'redis', `${name}: session.save_handler`, rep); if (h !== 'redis') rep.notes.push(`${name}: ${h} tratado como armazenamento compartilhado (igual ao Redis).`); }
    else rep.notes.push(`${name}: session.save_handler = ${h} não é simulado.`);
  }
  // my.cnf: o MySQL aceita - ou _ nos nomes (max-connections = max_connections)
  const my = Object.fromEntries(Object.entries(flat).map(([k, v]) => [k.replace(/-/g, '_'), v]));
  const mysql = src => { if (rep.changes.db !== 'mysql') setCfg('db', 'mysql', src, rep); };
  if (my.max_connections !== undefined && !isNaN(+my.max_connections)) { found++; mysql(`${name}: max_connections`); setCfg('dbMaxConn', +my.max_connections, `${name}: max_connections`, rep); }
  if (my.innodb_lock_wait_timeout !== undefined && !isNaN(+my.innodb_lock_wait_timeout)) { found++; mysql(`${name}: innodb_lock_wait_timeout`); setCfg('lockWait', +my.innodb_lock_wait_timeout, `${name}: innodb_lock_wait_timeout`, rep); }
  const ap = parseApache(text, rep.mpmHint);
  if (ap) {
    found++;
    if (ap.guessed) rep.notes.push(`${name}: há blocos para vários MPMs e nenhum LoadModule; usei o primeiro (${ap.mpm}). Envie também o arquivo com o LoadModule do MPM.`);
    if (ap.mpm === 'prefork') setCfg('arch', 'A', `${name}: MPM prefork`, rep);
    else if (ap.mpm === 'event' || ap.mpm === 'worker') { setCfg('arch', 'B', `${name}: MPM ${ap.mpm}`, rep); if (ap.mpm === 'worker') rep.notes.push(`${name}: MPM worker tratado como event.`); }
    const total = ap.maxW !== null ? ap.maxW : (ap.tpc !== null && ap.sl !== null ? ap.tpc * ap.sl : null);
    if (total !== null) setCfg('T', total, `${name}: ${ap.maxW !== null ? 'MaxRequestWorkers' : 'ServerLimit × ThreadsPerChild'}`, rep);
    else rep.notes.push(`${name}: sem MaxRequestWorkers; mantive o valor atual de threads/processos.`);
  }
  const ignored = NOT_SIMULATED.filter(k => k in flat || k in pk || k in my);
  ignored.forEach(k => { if (!rep.skipped.includes(k)) rep.skipped.push(k); });
  if (!found) rep.notes.push(`${name}: não encontrei nenhuma chave reconhecida (pm.*, opcache.enable, session.save_handler, MaxRequestWorkers, max_connections…).`);
}

const stripHashComments = t => t.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
// Vários arquivos enviados juntos: o MPM do LoadModule de um vale para os outros (ex.: httpd.conf + extra/httpd-mpm.conf)
export function readConfigFiles(files) {
  const rep = newReport();
  const lm = files.map(([, t]) => stripHashComments(t).match(LOADED_MPM)).find(Boolean);
  if (lm) rep.mpmHint = lm[1].toLowerCase();
  for (const [name, text] of files) applyConfigText(name, text, rep);
  return rep;
}
