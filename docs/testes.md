# Testes

```bash
npm test            # motor (node:test), ~25 s
npm run test:e2e    # gera dist/ e roda a página no Chromium (Playwright), ~5 s
npm run check       # falha se dist/simulador.html estiver desatualizado
npm run check:links # links e âncoras de README.md e docs/ (precisa de rede)
```

Na primeira vez, se o Chromium do Playwright não estiver instalado: `npx playwright install chromium`.

## Estratégia

O motor (`src/engine/`) não usa DOM nem `Math.random` direto: recebe um gerador com seed (`src/engine/rng.js`). Com a mesma seed, a simulação é **exatamente** a mesma, então os testes são determinísticos.

| Arquivo | O que garante |
|---|---|
| `test/engine/parity.test.js` | O motor extraído reproduz `legacy/simulador.html` (o HTML original, rodado em `vm`) com a mesma seed, em 15 configurações e eventos. **Sai** quando o modelo mudar de propósito (ver abaixo). |
| `test/engine/fpm.test.js` | Regras do PHP-FPM segundo `fpm_process_ctl.c`: taxa dobrando até 32, limite pelo déficit, `max_children`, contador de limite atingido, remoção de 1 por segundo, ondemand. |
| `test/engine/rules.test.js` | Percurso e custos, OPcache, backlog → 503, 504 na fila e no fim do PHP, gargalo de threads, balanceadores, detecção de queda, 502/503, cliente lento A × B, sessões e Redis fora. |
| `test/engine/combinations.test.js` | **Invariantes** (`test/invariants.js`) checadas a cada passo numa grade `arch × nb × lb × pm × session × slowPct × opcache × timeout` com 3 níveis de carga e eventos (rajada, queda e volta de backend e Redis), mais 60 configurações aleatórias. |
| `test/engine/queueing.test.js` | Coerência com a teoria de filas: vazão ≈ min(chegadas, capacidade), latência com folga ≈ percurso + PHP, crescimento da fila saturada. |
| `test/engine/presets.test.js` | O que o texto de cada um dos 14 cenários promete. |
| `test/engine/config.test.js` | Leitura de configuração com os arquivos dos labs (`test/fixtures/`) e casos de borda. |
| `test/e2e/page.spec.js` | A página: sem erros no console, cenários e ações, botões, tabela de sessões, habilitação de parâmetros, balões, upload de configuração, `devicePixelRatio`, 390 px sem rolagem lateral, tema escuro. |

### Invariantes

Valem em qualquer configuração, a cada passo:

- criadas = concluídas + erros + em andamento;
- threads ocupadas = requisições com thread ≤ `T`; processos ocupados = slots ≤ `T`; workers ≤ `max_children`;
- vínculo worker ↔ requisição consistente; fila do FPM ≤ threads ocupadas;
- filas só com o estágio certo; fila do Apache ≤ 511; backend fora do ar sem estado;
- sem timer `NaN`; timer infinito só em fila;
- static sempre com `max_children` workers e contador de limite em 0;
- 502 só depois de derrubar um backend; 502/503 só sem backend listado; nenhum outro código;
- sessão perdida só com sessão em arquivo; resposta sem sessão só com o Redis fora;
- latência nunca menor que 510 ms + 85% da duração do PHP.

## Reproduzir uma falha

A mensagem traz a seed e a configuração:

```
t=4816 ms: fila do Apache 514 > backlog 511
  seed=5017 cfg={"arch":"B","nb":2,...}
```

```js
import { makeSim, runFor } from './test/helpers.js';
const sim = makeSim({ arch:'B', nb:2 /* ... */ }, 5017);
runFor(sim, 5);
```

Os eventos de `combinations.test.js` (rajada aos 2 s, queda do app1 aos 4 s, Redis fora aos 6 s, volta aos 9 e 10 s) estão em `EVENTS`.

## Como adicionar

- **Cenário:** acrescente em `src/model/presets.js` e um teste em `presets.test.js` com o que o texto promete. Documente em [funcionalidades.md](funcionalidades.md).
- **Regra do modelo:** teste em `rules.test.js` ou `fpm.test.js` citando a fonte ([referencias.md](referencias.md)).
- **Invariante:** em `test/invariants.js`; rode `npm test` e confira que ela não dispara à toa. Para saber se ela pega erros, introduza um defeito de propósito no motor e veja o teste falhar.

## Quando mudar o modelo de propósito

O teste de paridade vai falhar, porque o motor deixou de ser igual ao legado. Remova `parity.test.js` e `test/legacy.js` (ou mantenha `legacy/` só como referência), registre a mudança no [CHANGELOG](../CHANGELOG.md) e ajuste os testes de regra e de cenário ao novo comportamento.
