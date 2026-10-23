// Motor da simulação: estado e regras, sem DOM. Tempo simulado em ms.
// cfg é compartilhado com a interface: mudanças em cfg valem no próximo step().
import { initWorkers, maintain } from './fpm.js';

export const BACKLOG = 511;  // ListenBacklog padrão do Apache
export const NUSERS = 6;
// tempos fixos do percurso (ms): ida ao balanceador, ida ao backend, envio normal, volta ao cliente
export const HOP = 120, SEND = 20, BACK = 250, OPCACHE_COST = 120, ERR_LINGER = 700;

export function createSim(cfg, { rng = Math.random, on = () => {} } = {}) {
  let T = 0, reqs = [], users = [], backends = [], redis = { up:true, ops:0 }, seq = 0, rr = 0, nextArr = 0, stats;

  function resetStats() { stats = { done:0, errors:0, lost:0, noSess:0, lat:[], times:[], codes:{}, spawned:0 }; }
  function newBackend(i) {
    const b = { i, up:true, thrBusy:0, apacheQ:[], fpmQ:[], workers:[], procSlots:Array(cfg.T).fill(null), procBusy:0, warm:false, pmTimer:0, spawnN:1, maxReached:0, atMax:false, listed:true, flipAt:null };
    initWorkers(b, cfg, T); return b;
  }
  function reset() {
    T = 0; reqs = []; nextArr = 0; rr = 0; resetStats(); redis = { up:redis.up, ops:0 };
    users = Array.from({ length:NUSERS }, (_, i) => ({ id:i, hits:0, where:null, lostN:0, last:null }));
    backends = Array.from({ length:cfg.nb }, (_, i) => newBackend(i));
    on('reset');
  }
  function resetSessions() { users.forEach(u => { u.hits = 0; u.where = null; u.lostN = 0; u.last = null; }); }

  function spawnReq() {
    const u = users[Math.floor(rng() * users.length)];
    reqs.push({ id:++seq, u, t0:T, stage:'toLB', timer:HOP, b:-1, slow:rng() < cfg.slowPct / 100,
      thread:false, hasProc:false, slot:-1, worker:null, dead:false, msg:'' });
    stats.spawned++;
  }
  function pick(r) {
    const up = backends.filter(b => b.listed);
    if (!up.length) return null;
    if (cfg.lb === 'ip') return up[r.u.id % up.length];
    if (cfg.lb === 'lc') return up.reduce((a, b) => load(b) < load(a) ? b : a);
    return up[rr++ % up.length];
  }
  function load(b) { return b.thrBusy + b.procBusy + b.apacheQ.length + b.fpmQ.length; }

  function startExec(r, b) {
    r.stage = 'exec';
    let t = cfg.exec * (0.85 + rng() * 0.3);
    if (cfg.opcache === 'off') t += OPCACHE_COST; else if (!b.warm) { t += OPCACHE_COST; b.warm = true; }
    const u = r.u;
    if (cfg.session === 'file') {
      if (u.where !== null && u.where !== b.i) { u.last = { kind:'lost', b:b.i, from:u.where, t:T }; u.hits = 0; u.lostN++; stats.lost++; }
      else u.last = { kind:u.where === null ? 'new' : 'ok', b:b.i, t:T };
      u.where = b.i; u.hits++; t += 2;
    } else if (cfg.session === 'redis') {
      // sem Redis: o PHP só emite avisos e session_start() devolve false; os dados continuam no Redis
      if (!redis.up) { r.noSess = true; u.last = { kind:'nosess', b:b.i, t:T }; }
      else { u.last = { kind:u.where === 'redis' ? 'ok' : 'new', b:b.i, t:T }; u.hits++; u.where = 'redis'; t += 2 * cfg.redisMs; redis.ops += 2; on('redis-access', r); }
    }
    r.timer = t;
  }
  function acquireProc(r, b) {
    const idx = b.procSlots.indexOf(null); b.procSlots[idx] = r; r.slot = idx; b.procBusy++; r.hasProc = true; startExec(r, b);
  }
  function freeProc(r, b) {
    if (!r.hasProc) return;
    b.procSlots[r.slot] = null; r.hasProc = false; b.procBusy--;
    while (b.procBusy < cfg.T && b.apacheQ.length) acquireProc(b.apacheQ.shift(), b);
  }
  function freeThread(r, b) {
    if (!r.thread) return;
    r.thread = false; b.thrBusy--;
    while (b.thrBusy < cfg.T && b.apacheQ.length) { const n = b.apacheQ.shift(); b.thrBusy++; n.thread = true; n.stage = 'fpmq'; n.timer = Infinity; b.fpmQ.push(n); }
  }
  function fail(r, msg) {
    const b = backends[r.b];
    if (b) {
      if (r.worker) { r.worker.state = 'idle'; r.worker.req = null; r.worker.idleSince = T; r.worker = null; }
      b.apacheQ = b.apacheQ.filter(x => x !== r); b.fpmQ = b.fpmQ.filter(x => x !== r);
      freeThread(r, b); freeProc(r, b);
    }
    stats.errors++; stats.codes[msg] = (stats.codes[msg] || 0) + 1; r.stage = 'err'; r.timer = ERR_LINGER; r.msg = msg;
  }
  function arrive(r, b) {
    r.tArr = T;
    if (cfg.arch === 'B') {
      if (b.thrBusy < cfg.T) { b.thrBusy++; r.thread = true; r.stage = 'fpmq'; r.timer = Infinity; b.fpmQ.push(r); }
      else if (b.apacheQ.length >= BACKLOG) return fail(r, '503');
      else { r.stage = 'apacheq'; r.timer = Infinity; b.apacheQ.push(r); }
    } else if (b.procBusy < cfg.T) acquireProc(r, b);
    else if (b.apacheQ.length >= BACKLOG) return fail(r, '503');
    else { r.stage = 'apacheq'; r.timer = Infinity; b.apacheQ.push(r); }
  }
  function advance(r) {
    const b = backends[r.b];
    switch (r.stage) {
      case 'toLB': { const nb = pick(r); if (!nb) return fail(r, '502/503'); r.b = nb.i; r.stage = 'toBackend'; r.timer = HOP; break; }
      case 'toBackend': if (!b.up) return fail(r, '502'); arrive(r, b); break;
      case 'exec':
        if (T - r.tArr > cfg.timeout * 1000) return fail(r, '504');
        if (cfg.arch === 'B') { const w = r.worker; w.state = 'idle'; w.req = null; w.idleSince = T; r.worker = null; freeThread(r, b); }
        r.stage = 'send'; r.timer = r.slow ? cfg.slowMs : SEND; break;
      case 'send': if (cfg.arch === 'A') freeProc(r, b); r.stage = 'back'; r.timer = BACK; break;
      case 'back': {
        const lat = T - r.t0; stats.done++; if (r.noSess) stats.noSess++; stats.lat.push(lat); if (stats.lat.length > 200) stats.lat.shift(); stats.times.push(T); r.dead = true; break;
      }
      case 'err': r.dead = true; break;
    }
  }
  function step(dt) {
    T += dt;
    if (cfg.rate > 0) {
      nextArr -= dt;
      while (nextArr <= 0) { spawnReq(); nextArr += -Math.log(1 - rng()) / cfg.rate * 1000; }
    }
    for (const r of reqs.slice()) { r.timer -= dt; if (r.timer <= 0 && !r.dead) advance(r); }
    reqs = reqs.filter(r => !r.dead);
    backends.forEach(b => maintain(b, dt, cfg, T, startExec));
    for (const b of backends) if (b.flipAt !== null && T >= b.flipAt) { b.listed = b.up; b.flipAt = null; }
    for (const r of reqs) if (!r.dead && (r.stage === 'apacheq' || r.stage === 'fpmq') && T - r.tArr > cfg.timeout * 1000) fail(r, '504');
    stats.times = stats.times.filter(t => T - t < 5000);
  }
  function toggleBackend(i) {
    const b = backends[i];
    if (b.up) {
      // em A e em B quem entrega a resposta é o Apache deste backend: quem está em 'send' também falha
      for (const r of reqs.slice()) if (r.b === i && ['toBackend', 'apacheq', 'fpmq', 'exec', 'send'].includes(r.stage)) fail(r, '502');
      b.up = false; b.apacheQ = []; b.fpmQ = []; b.workers = []; b.thrBusy = 0; b.procBusy = 0; b.procSlots.fill(null);
    } else { b.up = true; b.warm = false; initWorkers(b, cfg, T); }
    if (cfg.detect === 0) { b.listed = b.up; b.flipAt = null; } else b.flipAt = T + cfg.detect * 1000;
    on('backends');
  }
  function burst(n = 20) { for (let i = 0; i < n; i++) spawnReq(); }
  function setRedis(up) { redis.up = up; }

  resetStats();
  return {
    cfg, reset, step, spawnReq, burst, toggleBackend, setRedis, resetSessions,
    get T() { return T; }, get reqs() { return reqs; }, get users() { return users; }, get backends() { return backends; },
    get redis() { return redis; }, get stats() { return stats; },
  };
}
