// Ponto de entrada da página: cria o motor, o desenho e os painéis, e roda o laço de animação.
import { createSim } from '../engine/sim.js';
import { readConfigFiles } from '../engine/config.js';
import { DEFAULTS } from '../model/params.js';
import { createCanvas } from './canvas.js';
import { createPanels } from './panels.js';

const $ = id => document.getElementById(id);
const cfg = { ...DEFAULTS };
let canvas, panels, paused = false;
const sim = createSim(cfg, {
  on: (ev, r) => {
    if (ev === 'reset') { canvas.clear(); panels.buildKillers(); }
    else if (ev === 'backends') panels.buildKillers();
    else if (ev === 'redis-access') canvas.redisAccess(r);
  },
});
canvas = createCanvas($('cv'), sim);
panels = createPanels(sim);

function frame(now) {
  const real = Math.min(50, now - (frame.last || now)); frame.last = now;
  if (!paused) sim.step(real * cfg.speed);
  canvas.animate(real);
  canvas.draw(); requestAnimationFrame(frame);
}

panels.bindTips();
panels.buildPresets();
$('burst').onclick = () => sim.burst(20);
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Continuar' : 'Pausar'; };
$('reset').onclick = () => sim.reset();
$('redisBtn').onclick = () => sim.setRedis(!sim.redis.up);
$('cfgfile').onchange = async e => {
  const files = [];
  for (const f of e.target.files) files.push([f.name, await f.text()]);
  panels.showConfigReport(readConfigFiles(files)); e.target.value = '';
};

panels.buildParams(); sim.reset(); setInterval(panels.showStats, 250);
requestAnimationFrame(frame);
