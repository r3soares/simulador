// Gerência de workers do PHP-FPM (pm = static | dynamic | ondemand).
// Regras conferidas em php-src PHP-8.4, sapi/fpm/fpm/fpm_process_ctl.c (ver docs/referencias.md).

export const HEARTBEAT = 1000;     // FPM_IDLE_SERVER_MAINTENANCE_HEARTBEAT (ms)
export const MAX_SPAWN_RATE = 32;  // pm.max_spawn_rate padrão
export const ONDEMAND_START = 200; // tempo de criação de um worker no ondemand (ilustrativo)

export function initWorkers(b, cfg, T) {
  b.workers = [];
  if (cfg.arch !== 'B' || cfg.pm === 'ondemand') return;
  const n = cfg.pm === 'static' ? cfg.W : Math.min(cfg.start, cfg.W);
  for (let i = 0; i < n; i++) b.workers.push({ state:'idle', req:null, idleSince:T });
}

// Avança dt ms no backend b: cria/remove workers e entrega requisições da fila aos ociosos.
// onRemove(w) é chamado para cada worker encerrado (ex.: soltar a conexão persistente com o MySQL).
export function maintain(b, dt, cfg, T, startExec, onRemove = () => {}) {
  if (!b.up || cfg.arch !== 'B') return;
  for (const w of b.workers) if (w.state === 'starting' && T >= w.readyAt) { w.state = 'idle'; w.idleSince = T; }
  b.pmTimer += dt;
  if (b.pmTimer >= HEARTBEAT) {
    b.pmTimer -= HEARTBEAT;
    const idle = b.workers.filter(w => w.state === 'idle');
    if (cfg.pm === 'dynamic') {
      // se ociosos < min_spare, cria min(taxa, min_spare - ociosos, max_children - total); a taxa dobra a cada segundo com déficit
      if (idle.length < cfg.minSpare) {
        if (b.workers.length < cfg.W) {
          const n = Math.min(b.spawnN, cfg.minSpare - idle.length, cfg.W - b.workers.length);
          for (let i = 0; i < n; i++) b.workers.push({ state:'idle', req:null, idleSince:T });
          b.spawnN = Math.min(b.spawnN * 2, MAX_SPAWN_RATE);
        } else { if (!b.atMax) { b.maxReached++; b.atMax = true; } b.spawnN = 1; }
      } else { b.spawnN = 1; b.atMax = false; }
      if (idle.length > cfg.maxSpare) { const w = idle.sort((a, c) => a.idleSince - c.idleSince)[0]; b.workers.splice(b.workers.indexOf(w), 1); onRemove(w); b.spawnN = 1; }
    } else if (cfg.pm === 'ondemand') {
      // como no php-fpm: no máximo um worker removido por passagem (1 s)
      const w = idle.filter(w => T - w.idleSince > cfg.idleTimeout * 1000).sort((a, c) => a.idleSince - c.idleSince)[0];
      if (w) { b.workers.splice(b.workers.indexOf(w), 1); onRemove(w); }
    }
  }
  if (cfg.pm === 'ondemand') {
    const cap = b.workers.filter(w => w.state === 'idle' || w.state === 'starting').length;
    let need = b.fpmQ.length - cap;
    while (need > 0 && b.workers.length < cfg.W) { b.workers.push({ state:'starting', req:null, idleSince:T, readyAt:T + ONDEMAND_START }); need--; }
    if (need > 0) { if (!b.atMax) { b.maxReached++; b.atMax = true; } } else b.atMax = false;
  }
  for (const w of b.workers) if (w.state === 'idle' && b.fpmQ.length) {
    const r = b.fpmQ.shift(); w.state = 'busy'; w.req = r; r.worker = w; startExec(r, b);
  }
}
