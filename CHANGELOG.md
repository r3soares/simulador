# Changelog

## 0.2.0 (2026-10-24)

MySQL no simulador.

- **Motor:** MySQL compartilhado por todos os backends (`db = 'mysql'`): conexão no início do script (não persistente ou persistente por worker/processo), `max_connections` (1040 → 500), consultas em núcleos com fila interna, lock de linha com `innodb_lock_wait_timeout` (1205 → 500), queda do banco (2002/2013 → 500). Requisição "fantasma": passando do timeout no banco, o cliente recebe 504 na hora e o worker continua preso. Com `db = 'none'` (padrão) o motor é idêntico ao anterior (o teste de paridade continua passando).
- **Padrão da página:** abre com sessão no Redis e MySQL ligados (antes: sem sessão). Os cenários continuam definindo sessão e banco por conta própria.
- **Novo código:** 500 (exceção do MySQL no PHP), só com MySQL.
- **Interface:** caixa do MySQL no canvas, botões Derrubar MySQL e Travar a linha, estado com conexões, pico de conexões, fila, lock, fantasmas e erros do MySQL. Ações de cenário que mudam parâmetro estrutural reiniciam a simulação.
- **Configuração:** leitura de `my.cnf` (`max_connections`, `innodb_lock_wait_timeout`).
- **Cenários (14 → 21):** Too many connections, Consulta sem índice, Conexões persistentes, MySQL fora do ar, N+1 consultas, Lock: 504 antes do erro do banco, Gargalo no MySQL: mais workers não ajudam. Texto de *Dependência lenta* aponta para eles.
- **Documentação:** referências oficiais do MySQL 8.4, PDO/mysqli, conexões persistentes e `php_error_cb` (§1, §2, §10), Lei de Little (§11), vereditos M1–M11, modelo, funcionalidades, roadmap.
- **Testes:** `mysql.test.js`, invariantes do MySQL (grade e configurações aleatórias), cenários novos, `my.cnf`, página.

## 0.1.0 (2026-10-23)

Primeira versão do projeto, a partir de `dashboard/simulador.html`.

- Motor separado da interface (`src/engine`), com gerador de números com seed; build em arquivo único (`dist/simulador.html`).
- Comportamento idêntico ao HTML original (teste de paridade), exceto pela correção de texto abaixo.
- Testes do motor (regras, invariantes em combinações, filas, cenários, configuração) e da página (Playwright).
- Documentação: funcionalidades, modelo, referências oficiais, vereditos, testes e roadmap.
- **Texto corrigido:** o balão "Tempo até o balanceador notar" e o cenário "Backend cai" diziam que o HAProxy, por padrão, refaz a requisição em outro servidor. Pelo manual, `retries` repete no **mesmo** servidor; outro servidor só com `option redispatch`.
