// Verifica os links externos de README.md e docs/*.md: a página responde e, quando há âncora (#...), ela existe.
// Precisa de rede. Uso: npm run check:links
import { readFileSync, readdirSync } from 'node:fs';

const files = ['README.md', ...readdirSync('docs').filter(f => f.endsWith('.md')).map(f => `docs/${f}`)];
const links = new Map(); // url → arquivos que a citam
for (const f of files) for (const [, url] of readFileSync(f, 'utf8').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) links.set(url, [...(links.get(url) || []), f]);

const pages = new Map(); // cache por página (sem âncora)
async function fetchPage(url) {
  if (!pages.has(url)) pages.set(url, fetch(url, { redirect:'follow', headers:{ 'user-agent':'check-links' } }).then(async r => ({ status:r.status, body:r.ok ? await r.text() : '' })).catch(e => ({ status:0, body:'', error:e.message })));
  return pages.get(url);
}
// âncoras do GitHub (renderizadas no navegador) e de cabeçalhos markdown não são verificáveis no HTML bruto
const skipAnchor = u => /github\.com\//.test(u.host + u.pathname);

let bad = 0;
await Promise.all([...links.keys()].map(async raw => {
  const u = new URL(raw), hash = decodeURIComponent(u.hash.slice(1)); u.hash = '';
  const p = await fetchPage(u.href);
  let problem = p.status !== 200 ? `HTTP ${p.status || p.error}` : '';
  if (!problem && hash && !skipAnchor(u)) {
    const esc = hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(id|name)=["']${esc}["']`).test(p.body)) problem = `âncora #${hash} não encontrada`;
  }
  if (problem) { bad++; console.log(`✗ ${raw}\n    ${problem} (em ${links.get(raw).join(', ')})`); }
}));
console.log(`${links.size} links, ${bad} com problema`);
process.exit(bad ? 1 : 0);
