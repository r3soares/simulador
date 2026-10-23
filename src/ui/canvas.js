// Desenho da simulação no <canvas>. Guarda só o que é visual (posição e jitter das bolinhas, linhas do Redis);
// o estado da simulação vem do motor.
export const COLORS = ['#1c7ed6', '#e8590c', '#2f9e44', '#7048e8', '#d6336c', '#f08c00'];
const W = 980, PX = 250, PW = 570, PH = 185, STEP = 205, CLX = 55, LBX = 170, RX = 860;
export const H = 40 + 3 * STEP + 5; // altura fixa (cabem 3 backends): evita que a página se desloque ao mudar o nº de backends
const QCAP_A = 34, QCAP_F = 44;
const userY = id => 40 + id * (H - 80) / 5;

// grade de células: até 24 unidades = quadrados grandes; acima disso, quadrados pequenos e, passando de 144, cada quadrado agrupa k unidades
export const gl = n => n <= 24 ? { big:true, w:18, step:24, per:8, groups:n, k:1 } : { big:false, w:8, step:10, per:24, groups:Math.min(n, 144), k:Math.ceil(n / 144) };
const cell = (x0, y0, i, n) => { const L = gl(n), g = Math.min(Math.max(L.groups - 1, 0), Math.floor(i / L.k)); return { x:x0 + (g % L.per) * L.step + L.w / 2 + 1, y:y0 + Math.floor(g / L.per) * L.step + L.w / 2 + 1 }; };

export function createCanvas(cv, sim) {
  const cfg = sim.cfg, vis = new WeakMap(), qi = new WeakMap(), widx = new WeakMap();
  let lines = [];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const panelY = i => 20 + i * STEP + (3 - cfg.nb) * STEP / 2; // centraliza os backends na altura fixa
  const V = r => { let v = vis.get(r); if (!v) { v = { x:CLX, y:userY(r.u.id), jx:(Math.random() - .5) * 26, jy:(Math.random() - .5) * 26 }; vis.set(r, v); } return v; };

  function target(r, v) {
    const py = r.b >= 0 ? panelY(r.b) : 0, b = sim.backends[r.b];
    switch (r.stage) {
      case 'toLB': return { x:LBX + v.jx, y:H / 2 + v.jy };
      case 'toBackend': return { x:PX + v.jx / 2, y:py + 70 + v.jy };
      case 'apacheq': { const i = Math.min(qi.get(r) || 0, QCAP_A - 1); return { x:PX + 14 + (i % 17) * 11, y:py + PH - 20 + Math.floor(i / 17) * 10 }; }
      case 'fpmq': { const i = Math.min(qi.get(r) || 0, QCAP_F - 1); return { x:PX + 314 + (i % 22) * 11, y:py + PH - 20 + Math.floor(i / 22) * 10 }; }
      case 'exec': case 'send':
        if (cfg.arch === 'A' && r.slot >= 0) return cell(PX + 12, py + 44, r.slot, cfg.T);
        if (cfg.arch === 'B' && r.worker) return cell(PX + 312, py + 44, widx.get(r.worker) || 0, b.workers.length);
        return { x:LBX + v.jx, y:H / 2 + 38 + v.jy };
      case 'back': return { x:CLX + v.jx / 2, y:userY(r.u.id) + v.jy / 2 };
      default: return { x:v.x, y:v.y };
    }
  }

  // move as bolinhas em direção ao alvo (suavizado pelo tempo real decorrido)
  function animate(real) {
    for (const b of sim.backends) { b.apacheQ.forEach((r, i) => qi.set(r, i)); b.fpmQ.forEach((r, i) => qi.set(r, i)); b.workers.forEach((w, i) => widx.set(w, i)); }
    const a = 1 - Math.exp(-real / 90);
    for (const r of sim.reqs) { const v = V(r), t = target(r, v); v.x += (t.x - v.x) * a; v.y += (t.y - v.y) * a; }
    lines.forEach(l => l.life -= real / 400);
  }
  function redisAccess(r) { lines.push({ r, life:1 }); }
  function clear() { lines = []; }

  function draw() {
    const { users, backends, redis, reqs } = sim;
    const g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const fg = css('--fg'), muted = css('--muted'), line = css('--line'), soft = css('--soft'), blue = css('--blue'), orange = css('--orange'), red = css('--red');
    // buffer do canvas = largura exibida × devicePixelRatio, para o texto não ficar borrado ao ser esticado
    const k = (Number(cv.clientWidth) || W) / W, bw = Math.round(W * k * dpr), bh = Math.round(H * k * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    g.font = '12px system-ui'; g.textBaseline = 'middle';
    const txt = (s, x, y, c = fg, al = 'left', f) => { g.fillStyle = c; g.textAlign = al; if (f) g.font = f; g.fillText(s, x, y); g.font = '12px system-ui'; };
    const rr_ = (x, y, w, h, fill, stroke, dash) => { g.beginPath(); g.roundRect(x, y, w, h, 8); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); } };
    const drawCells = (x0, y0, n, busyOf, color, startingOf) => {
      const L = gl(n);
      for (let gi = 0; gi < L.groups; gi++) {
        const lo = gi * L.k, hi = Math.min(n, lo + L.k), size = hi - lo, c = cell(x0, y0, lo, n), left = c.x - L.w / 2, top = c.y - L.w / 2, bsy = busyOf(lo, hi);
        g.fillStyle = line; g.fillRect(left, top, L.w, L.w);
        if (bsy > 0) { const h = L.w * bsy / size; g.fillStyle = color; g.fillRect(left, top + L.w - h, L.w, h); }
        else if (startingOf && startingOf(lo, hi) > 0) { g.strokeStyle = muted; g.setLineDash([3, 3]); g.strokeRect(left, top, L.w, L.w); g.setLineDash([]); }
      }
    };
    // clientes e LB
    users.forEach(u => { const y = userY(u.id); g.beginPath(); g.arc(CLX, y, 11, 0, 7); g.fillStyle = COLORS[u.id]; g.fill(); txt('U' + (u.id + 1), CLX, y, '#fff', 'center', 'bold 10px system-ui'); });
    txt('Clientes', CLX, 12, muted, 'center');
    rr_(LBX - 42, H / 2 - 30, 84, 60, soft, line); txt('Balanceador', LBX, H / 2 - 8, fg, 'center', '11px system-ui'); txt({ rr:'round-robin', ip:'sticky', lc:'menos conexões' }[cfg.lb], LBX, H / 2 + 10, muted, 'center', '10px system-ui');
    g.strokeStyle = line; g.lineWidth = 1; users.forEach(u => { g.beginPath(); g.moveTo(CLX + 12, userY(u.id)); g.lineTo(LBX - 42, H / 2); g.stroke(); });
    // backends
    backends.forEach(b => {
      const py = panelY(b.i);
      g.strokeStyle = line; g.beginPath(); g.moveTo(LBX + 42, H / 2); g.lineTo(PX, py + 70); g.stroke();
      rr_(PX, py, PW, PH, soft, b.up ? line : red, b.up ? [] : [6, 4]);
      txt('app' + (b.i + 1) + (b.up ? (b.listed ? '' : '  (no ar; o balanceador ainda não o usa)') : (b.listed ? '  (FORA DO AR; o balanceador ainda não notou)' : '  (FORA DO AR)')), PX + 10, py + 14, b.up ? fg : red, 'left', 'bold 13px system-ui');
      if (!b.up) return;
      if (cfg.session === 'file') {
        txt('sessões em arquivo local', PX + PW - 12, py + 14, muted, 'right', '11px system-ui');
        users.filter(u => u.where === b.i).forEach((u, k) => { g.beginPath(); g.arc(PX + PW - 18 - k * 15, py + 30, 6, 0, 7); g.fillStyle = COLORS[u.id]; g.fill(); });
      }
      const A = cfg.arch === 'A';
      const LT = gl(cfg.T), kNote = L => L.k > 1 ? ` · 1 quadrado = ${L.k}` : '';
      txt(A ? 'Apache prefork + mod_php' : 'Apache event', PX + 12, py + 32, muted);
      drawCells(PX + 12, py + 44, cfg.T, (lo, hi) => A ? b.procSlots.slice(lo, hi).filter(Boolean).length : Math.max(0, Math.min(hi, b.thrBusy) - lo), A ? orange : blue);
      txt(`${A ? 'processos' : 'threads'} ocupados: ${A ? b.procBusy : b.thrBusy}/${cfg.T}${kNote(LT)}`, PX + 12, py + 118, muted);
      txt(`fila de espera: ${b.apacheQ.length}`, PX + 12, py + PH - 36, b.apacheQ.length ? orange : muted);
      if (!A) {
        const nw = b.workers.length, LW = gl(nw);
        txt(`php-fpm · pm=${cfg.pm}`, PX + 312, py + 32, muted);
        const cnt = (lo, hi, st) => { let c = 0; for (let i = lo; i < hi; i++) if (b.workers[i].state === st) c++; return c; };
        drawCells(PX + 312, py + 44, nw, (lo, hi) => cnt(lo, hi, 'busy'), orange, (lo, hi) => cnt(lo, hi, 'starting'));
        txt(`workers ocupados: ${cnt(0, nw, 'busy')}/${nw}${kNote(LW)}`, PX + 312, py + 118, muted);
        txt(`max_children ${cfg.W}` + (b.maxReached ? ` · limite atingido ×${b.maxReached}` : ''), PX + 312, py + 132, b.maxReached ? orange : muted);
        txt(`fila do FPM (listen queue): ${b.fpmQ.length}`, PX + 312, py + PH - 36, b.fpmQ.length ? orange : muted);
      } else txt('o PHP roda dentro de cada processo', PX + 312, py + 70, muted);
    });
    // redis
    const ry = H / 2 - 50, usingRedis = cfg.session === 'redis';
    g.globalAlpha = usingRedis ? 1 : .35; rr_(RX - 20, ry, 130, 100, soft, redis.up ? line : red, redis.up ? [] : [6, 4]);
    txt('Redis', RX + 45, ry + 18, fg, 'center', 'bold 13px system-ui'); txt(redis.up ? 'no ar' : 'FORA DO AR', RX + 45, ry + 40, redis.up ? muted : red, 'center'); txt('acessos: ' + redis.ops, RX + 45, ry + 62, muted, 'center'); txt(usingRedis ? 'sessões:' : '(não usado)', RX + 45, ry + 80, muted, 'center');
    if (usingRedis) users.filter(u => u.where === 'redis').forEach((u, k, a) => { g.beginPath(); g.arc(RX + 45 + (k - (a.length - 1) / 2) * 15, ry + 92, 5, 0, 7); g.fillStyle = COLORS[u.id]; g.fill(); });
    g.globalAlpha = 1;
    lines = lines.filter(l => l.life > 0);
    lines.forEach(l => { const v = V(l.r); g.globalAlpha = Math.max(0, l.life); g.strokeStyle = blue; g.lineWidth = 2; g.beginPath(); g.moveTo(v.x, v.y); g.lineTo(RX - 20, ry + 50); g.stroke(); g.globalAlpha = 1; g.lineWidth = 1; });
    // requisições
    reqs.forEach(r => {
      if ((r.stage === 'apacheq' && (qi.get(r) || 0) >= QCAP_A) || (r.stage === 'fpmq' && (qi.get(r) || 0) >= QCAP_F)) return;
      if (r.stage === 'exec' && !gl(cfg.arch === 'A' ? cfg.T : (backends[r.b] ? backends[r.b].workers.length : 0)).big) return;
      const v = V(r), color = COLORS[r.u.id];
      g.beginPath(); g.arc(v.x, v.y, 6, 0, 7);
      if (r.noSess && r.stage !== 'err') { g.strokeStyle = color; g.lineWidth = 2.5; g.stroke(); g.lineWidth = 1; } else { g.fillStyle = r.stage === 'err' ? red : color; g.fill(); }
      if (r.slow) { g.beginPath(); g.arc(v.x, v.y, 9, 0, 7); g.strokeStyle = fg; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1; }
      if (r.stage === 'err') txt(r.msg, v.x + 10, v.y - 10, red, 'left', 'bold 11px system-ui');
    });
  }

  return { animate, draw, redisAccess, clear };
}
