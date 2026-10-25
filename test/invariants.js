// Invariantes: propriedades que devem valer em QUALQUER configuração, a cada passo da simulação.
// checkInvariants lança um erro descrevendo a primeira violação encontrada.
import { BACKLOG, HOP, SEND, BACK, DB_STAGES } from '../src/engine/sim.js';

const MIN_PATH = 2 * HOP + SEND + BACK; // menor tempo de percurso possível, sem contar o PHP

export function createChecker(cfg) {
  let lastT = -1, lastDone = 0, minExec = cfg.exec;
  const seen = { backendDown:false, allDown:false, redisDown:false, dbDown:false, dbLocked:false };

  return function check(sim) {
    const { T, reqs, backends, stats, users, redis, db } = sim;
    const fail = msg => { throw new Error(`t=${Math.round(T)} ms: ${msg}`); };

    if (!(T > lastT)) fail('o tempo não avançou');
    minExec = Math.min(minExec, cfg.exec); // a duração do PHP pode mudar durante a simulação (ex.: "Banco ficou lento")
    lastT = T;
    if (backends.some(b => !b.up)) seen.backendDown = true;
    if (backends.every(b => !b.listed)) seen.allDown = true;
    if (!redis.up) seen.redisDown = true;
    if (!db.up) seen.dbDown = true;
    if (db.locked) seen.dbLocked = true;

    // conservação: toda requisição criada terminou, falhou ou está em andamento
    // (o fantasma já foi contado como erro 504: o cliente desistiu, só o PHP continua)
    const active = reqs.filter(r => r.stage !== 'err' && !r.ghost).length;
    if (stats.spawned !== stats.done + stats.errors + active) fail(`criadas ${stats.spawned} ≠ concluídas ${stats.done} + erros ${stats.errors} + em andamento ${active}`);

    for (const r of reqs) {
      if (Number.isNaN(r.timer)) fail(`timer NaN na requisição ${r.id} (${r.stage})`);
      if (r.timer === Infinity && r.stage !== 'apacheq' && r.stage !== 'fpmq' && r.stage !== 'dbq') fail(`timer infinito fora de fila (${r.stage})`);
      if (r.b >= 0 && r.stage !== 'err' && r.stage !== 'back' && r.stage !== 'toBackend' && !backends[r.b].up) fail(`requisição ${r.id} em ${r.stage} num backend fora do ar`);
      if (r.stage === 'apacheq' && !backends[r.b].apacheQ.includes(r)) fail(`requisição ${r.id} em apacheq fora da fila do Apache`);
      if (r.stage === 'fpmq' && !backends[r.b].fpmQ.includes(r)) fail(`requisição ${r.id} em fpmq fora da fila do FPM`);
      if (r.worker && (r.worker.req !== r || r.worker.state !== 'busy' || !['exec', ...DB_STAGES].includes(r.stage))) fail(`vínculo requisição↔worker inconsistente (${r.id})`);
      if (r.ghost && (r.thread || !DB_STAGES.includes(r.stage))) fail(`fantasma ${r.id} com thread ou fora do banco (${r.stage})`);
      if (r.conn && cfg.dbPersist === 'on') fail('conexão da requisição com conexões persistentes ligadas');
      if (r.thread && cfg.arch !== 'B') fail('thread ocupada na arquitetura A');
      if (r.hasProc && cfg.arch !== 'A') fail('processo ocupado na arquitetura B');
    }

    for (const b of backends) {
      const mine = reqs.filter(r => r.b === b.i);
      if (b.apacheQ.length > BACKLOG) fail(`fila do Apache ${b.apacheQ.length} > backlog ${BACKLOG}`);
      if (b.apacheQ.some(r => r.stage !== 'apacheq')) fail('fila do Apache com estágio errado');
      if (b.fpmQ.some(r => r.stage !== 'fpmq')) fail('fila do FPM com estágio errado');
      if (!b.up && (b.workers.length || b.apacheQ.length || b.fpmQ.length || b.thrBusy || b.procBusy)) fail(`app${b.i + 1} fora do ar com estado`);
      if (cfg.arch === 'B') {
        const thr = mine.filter(r => r.thread).length;
        if (b.thrBusy !== thr) fail(`app${b.i + 1}: thrBusy ${b.thrBusy} ≠ ${thr} requisições com thread`);
        if (b.thrBusy > cfg.T) fail(`app${b.i + 1}: threads ${b.thrBusy} > T ${cfg.T}`);
        if (b.workers.length > cfg.W) fail(`app${b.i + 1}: workers ${b.workers.length} > max_children ${cfg.W}`);
        if (b.fpmQ.length > b.thrBusy) fail('fila do FPM maior que as threads ocupadas (toda requisição no FPM segura uma thread)');
        for (const w of b.workers) {
          if (w.state === 'busy' && (!w.req || w.req.worker !== w)) fail('worker ocupado sem requisição');
          if (w.state !== 'busy' && w.req) fail('worker livre com requisição');
          if (w.state === 'starting' && cfg.pm !== 'ondemand') fail('worker "iniciando" fora do ondemand');
        }
        if (cfg.pm === 'static' && b.up && b.workers.length !== cfg.W) fail(`static com ${b.workers.length} workers (esperado ${cfg.W})`);
        if (cfg.pm === 'static' && b.maxReached) fail('static não deveria contar max_children atingido');
      } else {
        const proc = b.procSlots.filter(Boolean);
        if (b.procBusy !== proc.length) fail(`app${b.i + 1}: procBusy ${b.procBusy} ≠ ${proc.length} slots ocupados`);
        if (b.procBusy > cfg.T) fail(`app${b.i + 1}: processos ${b.procBusy} > T ${cfg.T}`);
        if (proc.some(r => !r.hasProc || r.b !== b.i)) fail('slot de processo com requisição errada');
        if (b.workers.length) fail('workers do FPM na arquitetura A');
      }
    }

    // MySQL: conexões contadas = donos de conexão; núcleos, filas e estados coerentes
    const owners = reqs.filter(r => r.conn && !r.dead).length + backends.reduce((a, b) => a + b.workers.filter(w => w.conn).length + b.procConn.filter(Boolean).length, 0);
    if (db.conns !== owners) fail(`conexões MySQL ${db.conns} ≠ ${owners} donos (requisições, workers e processos)`);
    if (db.conns > cfg.dbMaxConn) fail(`conexões ${db.conns} > max_connections ${cfg.dbMaxConn}`);
    if (db.maxUsed < db.conns) fail('Max_used_connections menor que as conexões abertas');
    if (db.active.length > cfg.dbCores) fail(`${db.active.length} consultas executando > ${cfg.dbCores} núcleos`);
    if (db.active.some(r => r.stage !== 'db') || db.queue.some(r => r.stage !== 'dbq') || db.lockQ.some(r => r.stage !== 'dblock')) fail('fila do MySQL com estágio errado');
    if (db.queue.length && db.active.length < cfg.dbCores) fail('fila no MySQL com núcleo livre');
    for (const r of reqs) if (!r.dead && DB_STAGES.includes(r.stage) && ![db.active, db.queue, db.lockQ].some(q => q.includes(r))) fail(`requisição ${r.id} em ${r.stage} fora das filas do MySQL`);
    if (!db.up && (db.conns || db.active.length || db.queue.length || db.lockQ.length)) fail('MySQL fora do ar com conexões ou consultas');
    if (!db.locked && db.lockQ.length) fail('esperando lock sem linha travada');
    if (cfg.db !== 'mysql' && (db.conns || db.ops || reqs.some(r => DB_STAGES.includes(r.stage)) || Object.values(stats.dbErr).some(Boolean))) fail('atividade no MySQL sem banco');
    if (stats.dbErr['2013'] && !seen.dbDown) fail('2013 sem o MySQL ter caído');
    if (stats.dbErr['2002'] && !seen.dbDown) fail('2002 sem o MySQL ter caído');
    if (stats.dbErr['1205'] && !seen.dbLocked) fail('1205 sem lock');
    if ((stats.codes['500'] || 0) > Object.values(stats.dbErr).reduce((a, b) => a + b, 0)) fail('500 sem erro do MySQL correspondente');

    // erros só do tipo que a configuração e os eventos permitem
    for (const code of Object.keys(stats.codes)) {
      if (code === '502' && !seen.backendDown) fail('502 sem backend fora do ar');
      if (code === '502/503' && !seen.allDown) fail('502/503 com backend disponível');
      if (code === '500' && cfg.db !== 'mysql') fail('500 sem MySQL');
      if (!['500', '502', '502/503', '503', '504'].includes(code)) fail(`código inesperado ${code}`);
    }
    if (stats.lost && cfg.session !== 'file') fail('sessão perdida sem sessão em arquivo');
    if (stats.noSess && !(cfg.session === 'redis' && seen.redisDown)) fail('resposta sem sessão sem o Redis ter caído');
    if (cfg.session !== 'redis' && redis.ops) fail('acessos ao Redis sem sessão no Redis');
    for (const u of users) if (u.hits < 0 || (u.where !== null && u.where !== 'redis' && !(u.where >= 0 && u.where < backends.length))) fail(`sessão inválida no usuário ${u.id}`);

    // latência nunca menor que o percurso fixo + o mínimo do PHP (exec × 0,85)
    if (stats.done > lastDone) {
      const lat = stats.lat[stats.lat.length - 1];
      if (lat < MIN_PATH + minExec * 0.85 - 1) fail(`latência ${lat} ms menor que o mínimo possível`);
      lastDone = stats.done;
    }
  };
}
