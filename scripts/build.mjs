// Gera dist/simulador.html: src/index.html com o bundle de src/ui/main.js embutido (abre por file://, sem servidor).
//   node scripts/build.mjs           gera
//   node scripts/build.mjs --watch   regera a cada mudança em src/
//   node scripts/build.mjs --check   falha se dist/ estiver desatualizado
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MARK = /<!-- build:js[^>]*-->/;
const OUT = 'dist/simulador.html';
const opts = { entryPoints:['src/ui/main.js'], bundle:true, format:'iife', target:'es2020', write:false, legalComments:'none' };

function page(js) {
  const html = readFileSync('src/index.html', 'utf8');
  if (!MARK.test(html)) throw new Error('src/index.html sem o marcador <!-- build:js -->');
  if (js.includes('</script')) throw new Error('o bundle contém "</script", que quebraria a página');
  return html.replace(MARK, () => `<script>\n${js}</script>`);
}

const mode = process.argv[2];
if (mode === '--watch') {
  const ctx = await esbuild.context({ ...opts, plugins:[{ name:'html', setup(b) { b.onEnd(r => { if (!r.errors.length) { writeFileSync(OUT, page(r.outputFiles[0].text)); console.log('gerado', OUT); } }); } }] });
  await ctx.watch();
} else {
  const r = await esbuild.build(opts), out = page(r.outputFiles[0].text);
  if (mode === '--check') {
    if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== out) { console.error(`${OUT} está desatualizado: rode npm run build`); process.exit(1); }
    console.log(`${OUT} em dia`);
  } else { writeFileSync(OUT, out); console.log('gerado', OUT); }
}
