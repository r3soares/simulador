// Roda o <script> de legacy/simulador.html dentro de vm, com DOM falso e Math.random substituível.
// Usado só pelo teste de paridade.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function loadLegacy(rng) {
  const html = readFileSync(new URL('../legacy/simulador.html', import.meta.url), 'utf8');
  let code = html.split('<script>')[1].split('</script>')[0];
  // o jitter visual consome Math.random no legado; o motor novo não sorteia isso
  const jitter = 'jx:(Math.random() - .5) * 26, jy:(Math.random() - .5) * 26';
  if (!code.includes(jitter)) throw new Error('trecho de jitter não encontrado no legado');
  code = code.replace(jitter, 'jx:0, jy:0');
  const dummy = () => new Proxy(function () {}, { get: (t, p) => p === 'length' ? 0 : p === Symbol.toPrimitive ? () => 0 : dummy(), apply: () => dummy(), set: () => true });
  const els = {};
  const math = Object.create(Math); math.random = rng;
  const ctx = { document:{ getElementById: id => els[id] ||= dummy(), querySelectorAll: () => [], addEventListener: () => {}, documentElement:{} },
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }), setInterval: () => 0, console, Math:math };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(code + `;globalThis.__t = { cfg, reset, step, spawnReq, toggleBackend,
    get T(){return T}, get stats(){return stats}, get reqs(){return reqs}, get backends(){return backends}, get users(){return users}, get redis(){return redis} };`, ctx);
  return ctx.__t;
}
