// Painéis HTML: parâmetros, botões de derrubar backend, estado, tabela de sessões, cenários e relatório de configuração.
import { PARAMS, GROUPS, ENABLE, idxOf } from '../model/params.js';
import { CATS, PRESETS, PRESET_BASE } from '../model/presets.js';
import { COLORS } from './canvas.js';

const $ = id => document.getElementById(id);

export function createPanels(sim) {
  const cfg = sim.cfg;

  function updateEnabled() {
    document.querySelectorAll('#params .prm').forEach(div => {
      const el = div.querySelector('[data-k]'), f = el && ENABLE[el.dataset.k], on = f ? f(cfg) : true;
      if (el) el.disabled = !on; div.classList.toggle('off', !on);
    });
  }
  function buildParams() {
    const one = p => {
      const v = cfg[p.k];
      const input = p.opts ? `<select data-k="${p.k}">${p.opts.map(o => `<option value="${o[0]}"${String(v) === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`
        : p.vals ? `<input type="range" data-k="${p.k}" min="0" max="${p.vals.length - 1}" step="1" value="${idxOf(p.vals, v)}">`
        : `<input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">`;
      return `<div class="prm"><label>${p.label}${p.tip ? '<span class="q" role="button" tabindex="0" aria-label="Explicação">?</span>' : ''}${p.opts ? '' : `<span class="v" id="v-${p.k}">${v}</span>`}</label>${input}${p.tip ? `<span class="tipbox">${p.tip}</span>` : ''}</div>`;
    };
    $('params').innerHTML = GROUPS.map(([title, keys]) => `<div class="grp"><h3>${title}</h3><div class="grid">${keys.map(k => one(PARAMS.find(p => p.k === k))).join('')}</div></div>`).join('');
    $('params').querySelectorAll('[data-k]').forEach(el => el.oninput = () => {
      const p = PARAMS.find(x => x.k === el.dataset.k), isNum = typeof cfg[p.k] === 'number';
      cfg[p.k] = p.vals ? p.vals[+el.value] : isNum ? +el.value : el.value; if (p.k === 'speed') cfg.speed = +el.value;
      const v = $('v-' + p.k); if (v) v.textContent = cfg[p.k];
      if (p.k === 'session') sim.resetSessions();
      if (p.struct) sim.reset();
      updateEnabled();
    });
    updateEnabled();
  }
  function buildKillers() {
    $('killers').innerHTML = sim.backends.map(b => `<button data-b="${b.i}" class="${b.up ? 'st-up' : 'st-down'}">${b.up ? 'Derrubar' : 'Subir'} app${b.i + 1}</button>`).join('');
    $('killers').querySelectorAll('button').forEach(el => el.onclick = () => sim.toggleBackend(+el.dataset.b));
  }
  function showStats() {
    const { stats, reqs, users, backends, redis, T } = sim;
    const l = stats.lat, avg = l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0, p95 = l.length ? [...l].sort((a, b) => a - b)[Math.floor(l.length * .95)] : 0;
    const f = ms => ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
    const items = [['em andamento', reqs.length], ['concluídas', stats.done], ['erros', stats.errors], ['vazão (req/s, últimos 5 s)', (stats.times.length / 5).toFixed(1)], ['latência média', l.length ? f(avg) : '-'], ['latência p95', l.length ? f(p95) : '-'], ['sessões perdidas', stats.lost]];
    if (stats.noSess) items.push(['respostas 200 sem sessão', stats.noSess]);
    const meaning = { '502': 'backend indisponível', '502/503': 'sem backend', '503': 'fila de conexões cheia', '504': 'tempo esgotado' };
    Object.entries(stats.codes).sort().forEach(([c, n]) => items.push(['erro ' + c + ' · ' + (meaning[c] || ''), n]));
    $('stats').innerHTML = items.map(([a, b]) => `<div><span>${a}</span><b${(a === 'erros' && b) || a.startsWith('erro ') ? ' style="color:var(--red)"' : ''}>${b}</b></div>`).join('');
    $('sesscard').hidden = cfg.session === 'none'; // tabela só faz sentido com sessão
    const app = i => 'app' + (i + 1), ago = t => { const s = Math.floor((T - t) / 1000); return s < 1 ? 'agora' : `há ${s} s`; };
    const where = u => u.where === null ? '-' : u.where === 'redis' ? (redis.up ? 'Redis (compartilhado)' : '<span class="bad">Redis (fora do ar)</span>')
      : `arquivo em ${app(u.where)}` + (backends[u.where] && !backends[u.where].up ? ' <span class="bad">(servidor fora do ar)</span>' : '');
    const last = l => !l ? '-' : `${app(l.b)}, ${ago(l.t)}: ` + {
      new:'<span class="ok">sessão criada</span>',
      ok:'<span class="ok">sessão encontrada</span>',
      lost:`<span class="bad">sessão perdida</span> (estava em ${app(l.from)})`,
      nosess:'<span class="bad">sessão não lida (Redis fora)</span>: resposta 200, usuário aparece deslogado' }[l.kind];
    $('sess').innerHTML = users.map(u => `<tr${u.last && (u.last.kind !== 'ok' && u.last.kind !== 'new') && T - u.last.t < 1500 ? ' class="flash"' : ''}><td><span class="dot" style="background:${COLORS[u.id]}"></span>U${u.id + 1}</td><td>${u.hits}</td><td>${where(u)}</td><td>${last(u.last)}</td><td>${u.lostN ? `<span class="bad">${u.lostN}</span>` : 0}</td></tr>`).join('');
    $('redisBtn').textContent = redis.up ? 'Derrubar Redis' : 'Subir Redis';
    $('redisBtn').className = redis.up ? 'st-up' : 'st-down';
  }
  function buildPresets() {
    $('presets').innerHTML = CATS.map(c => `<div class="pcat"><div class="pcat-t">${c}</div><div class="chips">${PRESETS.map((p, i) => p.cat === c ? `<button class="chip" data-i="${i}">${p.name}</button>` : '').join('')}</div></div>`).join('');
    $('presets').querySelectorAll('button').forEach(el => el.onclick = () => {
      const p = PRESETS[+el.dataset.i]; Object.assign(cfg, PRESET_BASE, p.cfg); sim.setRedis(true);
      document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
      $('desc').innerHTML = p.text + (p.actions ? '<div class="chips" style="margin-top:10px">' + p.actions.map((a, k) => `<button data-a="${k}">${a.label}</button>`).join('') + '</div>' : '');
      if (p.actions) $('desc').querySelectorAll('button').forEach(b => b.onclick = () => { Object.assign(cfg, p.actions[+b.dataset.a].set); buildParams(); });
      buildParams(); sim.reset();
    });
  }
  function showConfigReport(rep) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    if (rep.applied.length) { Object.assign(cfg, rep.changes); buildParams(); sim.reset(); }
    const ul = a => `<ul>${a.map(x => `<li>${x.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ul>`;
    $('cfgreport').innerHTML = (rep.applied.length ? `<b>Aplicado</b>${ul(rep.applied)}` : '')
      + (rep.skipped.length ? `<b>Reconhecido, mas não simulado</b>${ul(rep.skipped)}` : '')
      + (rep.notes.length ? `<b>Avisos</b>${ul(rep.notes)}` : '')
      + (rep.applied.length ? '<span class="note">A simulação foi reiniciada com esses valores. Duração do PHP, carga e clientes lentos continuam nos controles abaixo.</span>' : '');
  }
  // balões de ajuda (?) dos parâmetros
  function bindTips() {
    document.addEventListener('click', e => {
      const q = e.target.closest ? e.target.closest('.q') : null, box = q ? q.closest('.prm') : null;
      document.querySelectorAll('.prm.open').forEach(x => { if (x !== box) x.classList.remove('open'); });
      if (box) box.classList.toggle('open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.prm.open').forEach(x => x.classList.remove('open'));
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('q')) { e.preventDefault(); e.target.click(); }
    });
  }

  return { buildParams, buildKillers, showStats, buildPresets, showConfigReport, bindTips };
}
