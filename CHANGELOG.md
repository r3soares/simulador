# Changelog

## 0.1.0 (2026-10-23)

Primeira versão do projeto, a partir de `dashboard/simulador.html`.

- Motor separado da interface (`src/engine`), com gerador de números com seed; build em arquivo único (`dist/simulador.html`).
- Comportamento idêntico ao HTML original (teste de paridade), exceto pela correção de texto abaixo.
- Testes do motor (regras, invariantes em combinações, filas, cenários, configuração) e da página (Playwright).
- Documentação: funcionalidades, modelo, referências oficiais, vereditos, testes e roadmap.
- **Texto corrigido:** o balão "Tempo até o balanceador notar" e o cenário "Backend cai" diziam que o HAProxy, por padrão, refaz a requisição em outro servidor. Pelo manual, `retries` repete no **mesmo** servidor; outro servidor só com `option redispatch`.
