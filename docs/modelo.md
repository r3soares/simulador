# Modelo da simulação

Como o motor (`src/engine/`) funciona. Simulação de eventos discretos com tempo em milissegundos: `step(dt)` avança tudo `dt` ms (na página, `dt` = tempo real do quadro × velocidade, limitado a 50 ms). **Tudo é simulado**: os números servem para comparar situações, não são benchmark.

```
clientes (6 usuários) → balanceador → [backend 1..3] → (Redis para sessões)
                                       Apache event → PHP-FPM   (arquitetura B)
                                       Apache prefork + mod_php (arquitetura A)
```

## Percurso de uma requisição

Chegadas: processo de Poisson com média `rate` req/s (intervalos exponenciais). Cada requisição é de um dos 6 usuários, sorteado; com probabilidade `slowPct` o cliente é lento.

| Estágio | Duração | O que acontece |
|---|---|---|
| `toLB` | 120 ms | Vai ao balanceador, que escolhe um backend entre os **listados** (`rr`: rodízio; `ip`: `listados[id do usuário % n]`; `lc`: menor soma de ocupados e filas). Nenhum listado → **502/503**. |
| `toBackend` | 120 ms | Chega ao backend. Fora do ar → **502**. |
| chegada (B) | — | Se há thread livre (`thrBusy < T`), ocupa uma e entra na fila do FPM; senão entra na fila do Apache. Fila do Apache com 511 → **503**. |
| chegada (A) | — | Se há processo livre, ocupa e executa; senão, fila do Apache (mesmo limite 511 → 503). |
| `fpmq` (B) | espera | Um worker ocioso pega a primeira da fila. |
| `exec` | `exec × U(0,85; 1,15)` + custos | PHP rodando. Custos: OPcache desligado +120 ms (ou +120 ms na 1ª requisição de cada backend, aquecimento); sessão em arquivo +2 ms; Redis `2 × redisMs`. |
| fim do `exec` | — | Se passou de `timeout` desde a chegada ao backend → **504** (o worker já foi gasto). B: libera worker **e** thread. A: continua segurando o processo. |
| `send` | 20 ms, ou `slowMs` se cliente lento | Entrega ao cliente. A: segura o processo. B: não segura nada (suposição de buffering, ver abaixo). |
| `back` | 250 ms | Volta ao cliente. Latência medida = tempo total desde a criação (inclui as viagens: 510 ms fixos). |

Em qualquer momento, quem está em fila há mais que `timeout` sai com **504** sem consumir worker.

## PHP-FPM (`src/engine/fpm.js`)

Avaliado a cada 1 s (como o heartbeat do FPM), seguindo `fpm_process_ctl.c` ([referências §2](referencias.md#2-php-fpm)):

- **static:** `max_children` workers fixos.
- **dynamic:** começa com `min(start_servers, max_children)`. Se ociosos < `min_spare`: cria `min(taxa, min_spare − ociosos, max_children − total)`; a taxa dobra a cada segundo com déficit, até 32 (`pm.max_spawn_rate`), e volta a 1 quando não há déficit, ao atingir `max_children` ou ao remover. Se ociosos > `max_spare`: remove **um** por segundo (o ocioso há mais tempo). O contador "limite atingido" sobe uma vez por episódio.
- **ondemand:** começa com 0. Quando a fila excede (ociosos + iniciando), cria workers que levam **200 ms** para ficar prontos (valor ilustrativo). Remove **um** ocioso por segundo que passou de `process_idle_timeout`.

## Sessões

- **arquivo:** a sessão fica no backend onde foi criada. Requisição em outro backend → sessão perdida (contador do usuário volta a 0, `perdas` +1).
- **Redis:** um único Redis compartilhado, 2 acessos por requisição. **Redis fora:** como no PHP puro, `session_start()` falha só com avisos; a resposta é **200 sem sessão** (bolinha vazada), nada é gravado nem apagado, e a sessão volta quando o Redis volta ([referências §1 e §3](referencias.md#1-php-diretivas-ini-e-funções)). Frameworks costumam transformar isso em 500 ([§9](referencias.md#9-frameworks-o-que-acontece-quando-a-sessão-ou-o-redis-falha)).

## Falhas de backend

Derrubar um backend falha com **502** tudo o que estava nele (chegando, nas filas, executando e enviando), porque quem entrega a resposta é o Apache daquele backend. O balanceador só deixa de listá-lo depois de `detect` segundos; nesse intervalo, novas requisições ainda vão a ele e dão 502. A volta também leva `detect` segundos. **Não há nova tentativa** no balanceador.

## Constantes

| Constante | Valor | Origem |
|---|---|---|
| Viagens (`HOP`, `SEND`, `BACK`) | 120, 20, 250 ms | arbitrárias |
| Backlog do Apache | 511 | `ListenBacklog` padrão |
| Custo do OPcache desligado | 120 ms | ilustrativo (no lab 04: ~58 ms sem cache vs ~1,3 ms com, 400 arquivos) |
| Variação do PHP | ±15% | arbitrária |
| Partida de worker no ondemand | 200 ms | ilustrativa |
| Heartbeat do FPM | 1000 ms | `FPM_IDLE_SERVER_MAINTENANCE_HEARTBEAT` |
| Teto da taxa de criação (dynamic) | 32 | `pm.max_spawn_rate` padrão |
| Usuários | 6 | — |

## Simplificações que podem levar a conclusões erradas

| Simplificação | Como o real é | Onde está avisado |
|---|---|---|
| Arquitetura B libera o worker do FPM antes do envio ao cliente lento. | Vale para nginx com `fastcgi_buffering`. Com Apache + `mod_proxy_fcgi`, a thread fica presa até o fim e, em respostas grandes, o worker também. | Cenário "Cliente lento: event + FPM". |
| Fila do Apache cheia → 503 imediato. | No Linux, com `tcp_abort_on_overflow = 0`, o cliente retransmite e espera; não há 503. | Cenário "Escala". |
| Balanceador sem nova tentativa. | nginx refaz em outro servidor por padrão; HAProxy repete no mesmo (muda só com `option redispatch`). | Balão `detect` e cenário "Backend cai". |
| Timeout como limite de **espera total** desde a chegada ao backend. | `fastcgi_read_timeout` e `ProxyTimeout` contam inatividade entre leituras. Para scripts que só respondem no fim, dá quase no mesmo. | Balão `timeout`. |
| Requisições que expiram na fila saem sem gastar worker. | Provavelmente o FPM ainda aceita e executa conexões já abandonadas pelo cliente, e o real seria **pior** (**não verificado** em fonte oficial). | [roadmap](roadmap.md). |
| Sticky por usuário, remapeado por módulo. | nginx `ip_hash` usa o /24 do IPv4 e, se um servidor falha, só desvia os usuários dele. O módulo corresponde ao HAProxy `hash-type map-based`. | Cenários de sessão. |
| Fila do FPM sem limite próprio (limitada só pelas threads do Apache). | `listen.backlog` = `somaxconn` no Linux; socket Unix cheio → nginx 502. | [roadmap](roadmap.md). |
| Sem keep-alive, sem TLS, rede sem perda, um Redis sem rede. | — | — |
| Sessão sem trava. | "Session data is locked to prevent concurrent writes only one script may operate on a session at any time" ([`session_write_close`](https://www.php.net/manual/en/function.session-write-close.php)): requisições simultâneas do mesmo usuário esperam uma pela outra (no phpredis a trava é opcional). | [roadmap](roadmap.md). |
| Sessão no Redis nunca expira. | Expira em `session.gc_maxlifetime` (padrão 24 min) sem acesso. | [roadmap](roadmap.md). |
