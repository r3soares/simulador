# Simulador PHP: do cliente ao PHP

Simulação didática de uma pilha web PHP, desenhada no navegador:

```
clientes → balanceador → [backend 1..3: Apache event + PHP-FPM | Apache prefork + mod_php] → Redis (sessões)
```

Mostra filas, saturação, timeouts, quedas de backend, sessões e a gerência de workers do PHP-FPM (static, dynamic, ondemand). **Tudo é simulado**: os números servem para comparar situações, não são benchmark. As regras seguem a documentação e o código-fonte oficiais ([docs/referencias.md](docs/referencias.md)).

## Usar

Abra **`dist/simulador.html`** no navegador (funciona direto do disco, sem servidor e sem internet). É um arquivo único e pode ser compartilhado sozinho.

## Desenvolver

Requer Node 22+.

```bash
npm install
npm run dev         # regera dist/simulador.html a cada mudança em src/
npm run build       # gera dist/simulador.html
npm test            # testes do motor
npm run test:e2e    # testes da página (Playwright/Chromium)
npm run check       # dist/ está em dia com src/?
npm run check:links # links das referências ainda respondem? (rede)
```

`dist/simulador.html` é versionado para poder ser compartilhado sem build: rode `npm run build` antes de cada commit que mude `src/`.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `src/engine/` | Motor sem DOM: `sim.js` (percurso, filas, falhas, sessões), `fpm.js` (gerência de workers), `config.js` (leitura de php.ini, pool do FPM e Apache), `rng.js` (gerador com seed). |
| `src/model/` | Parâmetros (valores, balões, grupos, quando se aplicam) e os 14 cenários. |
| `src/ui/` | Canvas, painéis HTML e laço de animação. |
| `src/index.html` | Marcação e CSS; o build injeta o JavaScript. |
| `scripts/` | `build.mjs` (esbuild → arquivo único) e `check-links.mjs`. |
| `test/` | Testes do motor (`engine/`), da página (`e2e/`), invariantes, fixtures dos labs. |
| `legacy/simulador.html` | Cópia do HTML original, usada no teste de paridade. |
| `docs/` | Documentação (abaixo). |

## Documentação

- [Funcionalidades](docs/funcionalidades.md): cenários, ações, painéis, leitura de configuração e cada parâmetro, com link para a diretiva oficial.
- [Modelo](docs/modelo.md): como a simulação funciona, constantes e simplificações que podem enganar.
- [Referências oficiais](docs/referencias.md): `.ini` do PHP, PHP-FPM, phpredis, Apache, nginx, HAProxy, Linux, RFC 9110 e frameworks.
- [Vereditos da revisão](docs/fontes.md): cada afirmação técnica conferida.
- [Testes](docs/testes.md): estratégia, invariantes, como reproduzir uma falha.
- [Roadmap](docs/roadmap.md): melhorias e pendências.
- [CHANGELOG](CHANGELOG.md).
