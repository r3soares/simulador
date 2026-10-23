# Vereditos da revisão técnica

Cada afirmação técnica do simulador, com o veredito e a fonte. A numeração segue a revisão original (`dashboard/REVISAO-SIMULADOR.md`, §6). Os links completos estão em [referencias.md](referencias.md).

Legenda: ✅ confirmado em fonte oficial · ⚠️ impreciso ou com ressalva · ❌ errado (corrigido no simulador) · ❓ não verificado.

## PHP-FPM

| # | Afirmação | Veredito | Fonte |
|---|---|---|---|
| F1 | dynamic cria `min(taxa, min_spare − ociosos)`, limitado por `max_children − running`; a taxa dobra até `pm.max_spawn_rate` e volta a 1 | ✅ teto 32; heartbeat de 1 s | `fpm_process_ctl.c`/`.h`, manual do FPM |
| F2 | dynamic remove um ocioso por passagem acima de `max_spare` | ✅ (o FPM remove o processo mais antigo; o simulador, o ocioso há mais tempo) | `fpm_process_ctl.c` |
| F3 | ondemand remove o ocioso que passou de `process_idle_timeout` | ✅ **um** por passagem (corrigido: antes removia todos de uma vez) | `fpm_process_ctl.c` |
| F4 | "max children reached" só sobe em dynamic/ondemand, uma vez por episódio | ✅ | `fpm_process_ctl.c` |
| F5 | um worker atende uma requisição por vez; no ondemand o master cria 1 filho por conexão pendente | ✅ | `fpm_process_ctl.c` (`fpm_pctl_on_socket_accept`) |
| F6 | ondemand reduz os workers depois do timeout | ✅ pelo código, gradualmente. Teste em container ainda não feito ([roadmap](roadmap.md)) | `fpm_process_ctl.c` |
| F7 | o 4096 de `listen queue len` no `fpm-status` | ✅ `listen.backlog` padrão é -1 no Linux → `somaxconn` = 4096 (Linux ≥ 5.4). O manual diz 511; o código diz -1 | `fpm_sockets.h`, `listen(2)` |

## Apache

| # | Afirmação | Veredito | Fonte |
|---|---|---|---|
| A1 | no event + `mod_proxy_fcgi`, a requisição ocupa uma thread durante toda a espera no FPM | ✅ | doc do MPM event |
| A2 | o event libera threads de keep-alive ocioso e no *write completion* | ✅ com ressalva: "might be able to"; não vale para FCGI/proxy | doc do MPM event |
| A3 | cliente lento + event + FPM: o worker do FPM é liberado | ❌ **para o Apache**: a thread fica até o fim e, em respostas grandes, o worker também. Vale para nginx com `fastcgi_buffering`. Texto do cenário corrigido | doc do MPM event, `fastcgi_buffering` |
| A4 | no prefork o processo fica preso até entregar tudo; o keep-alive também o prende | ⚠️ certo para respostas grandes/conexões lentas; respostas pequenas cabem nos buffers do kernel | doc do prefork, `KeepAlive` |
| A5 | `ListenBacklog` padrão 511 | ✅ (limitado por `somaxconn`) | `mpm_common` |
| A6 | mod_php, na prática, com prefork | ✅ "mod_php requires the prefork MPM unless PHP was compiled with thread safety" | manual do PHP (Apache 2.x) |
| A7 | `Timeout` padrão 60 s | ✅; para o FCGI vale `ProxyTimeout` (padrão = `Timeout`) | `core`, `mod_proxy` |

## nginx, HAProxy e balanceamento

| # | Afirmação | Veredito | Fonte |
|---|---|---|---|
| N1 | `ip_hash` usa os 3 primeiros octetos do IPv4 | ✅ | `ngx_http_upstream_module` |
| N2 | marcar `down` preserva o mapeamento dos outros | ✅ | idem |
| N3 | `fastcgi_read_timeout` 60 s, entre leituras | ✅ | `ngx_http_fastcgi_module` |
| N4 | sem backend vivo: nginx 502, HAProxy 503 | ✅ HAProxy: "503 when no server was available"; nginx: `$upstream_status` fica com 502 quando nenhum servidor pode ser escolhido | manuais |
| N5 | nginx refaz em outro upstream; HAProxy só repete falha de conexão | ⚠️ HAProxy: `retry-on` padrão `conn-failure`, mas configurável (2.0+); as tentativas vão ao **mesmo servidor**, salvo `option redispatch` (balão e cenário corrigidos) | `proxy_next_upstream`, HAProxy `retries`/`retry-on`/`option redispatch` |
| N6 | detecção: HAProxy ativo ≈ `inter × fall`; nginx open source só passivo | ✅ `inter` 2 s, `fall` 3, `rise` 2; nginx `max_fails` 1 em `fail_timeout` 10 s | manuais |
| N7 | fila cheia: TCP retransmite (sem RST); socket Unix → `EAGAIN` → 502 | ✅ `tcp_abort_on_overflow` padrão FALSE; `connect(2)` com `EAGAIN` em socket Unix não bloqueante. O 502 do nginx nesse caso não foi conferido em teste | `ip-sysctl`, `connect(2)` |

## Aplicação, sessões e códigos HTTP

| # | Afirmação | Veredito | Fonte |
|---|---|---|---|
| P1 | Redis fora com `save_handler=redis` → 500 | ❌ no PHP puro: só `E_WARNING`, `session_start()` devolve `false`, resposta segue (200) **sem sessão**, dados preservados. O simulador passou a fazer isso. Frameworks: Laravel lança `ErrorException` (500); Symfony só em debug | `redis_session.c`, `session.c`, `session_start()`, Laravel `HandleExceptions`, Symfony `php_errors.throw` |
| P2 | OPcache em memória compartilhada; `validate_timestamps=0` não relê arquivos | ✅ (lab 04) | `opcache.configuration` |
| P3 | sessão em arquivo se perde ao trocar de backend | ✅ (lab 06) | — |
| P4 | 502 backend caído, 503 fila cheia/sem backend, 504 tempo esgotado | ✅ definições da RFC 9110; 500 não é mais usado | RFC 9110 §15.6 |
| P5 | 2 acessos ao Redis por requisição | ✅ (com `lazy_write`, o segundo vira atualização de validade) | `session.lazy_write` |
