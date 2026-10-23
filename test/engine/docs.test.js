// A documentação acompanha o código: todo parâmetro e todo cenário aparecem em docs/funcionalidades.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS } from '../../src/model/params.js';
import { PRESETS } from '../../src/model/presets.js';

const doc = readFileSync(new URL('../../docs/funcionalidades.md', import.meta.url), 'utf8');

test('todo parâmetro está documentado', () => {
  for (const p of PARAMS) assert.ok(doc.includes('`' + p.k + '`'), `parâmetro ${p.k} ausente em docs/funcionalidades.md`);
});
test('todo cenário está documentado', () => {
  for (const p of PRESETS) assert.ok(doc.includes(`**${p.name}**`), `cenário "${p.name}" ausente em docs/funcionalidades.md`);
});
