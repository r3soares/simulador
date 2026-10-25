# Referências oficiais

Fontes que sustentam o comportamento simulado e os textos da página. Cada item diz **o que a fonte afirma** e **como o simulador usa isso**. Todos os links foram abertos e o trecho citado foi conferido em 23/10/2026 (itens de MySQL, PDO/mysqli e conexões persistentes em 24/10/2026). `npm run check:links` verifica se os links (e as âncoras) continuam no ar.

Quando duas fontes oficiais discordam, vale o código-fonte, e a divergência fica registrada aqui.

Legenda: **[modelo]** o simulador implementa isso · **[texto]** aparece só em explicações (balões, cenários) · **[não simulado]** reconhecido, mas fora do modelo.

---

## 1. PHP: diretivas `.ini` e funções

| Diretiva / função | O que a fonte diz | No simulador |
|---|---|---|
| [`session.save_handler`](https://www.php.net/manual/en/session.configuration.php#ini.session.save-handler) | Define o armazenamento da sessão; padrão `files`. | **[modelo]** `files` → "arquivo local do backend"; `redis`/`memcached` → "Redis compartilhado" (leitura de configuração). |
| [`session.gc_maxlifetime`](https://www.php.net/manual/en/session.configuration.php#ini.session.gc-maxlifetime) | Padrão `1440` (24 minutos). | **[texto]** prazo de expiração da sessão no Redis; a expiração não é simulada (ver [roadmap](roadmap.md)). |
| [`session.lazy_write`](https://www.php.net/manual/en/session.configuration.php#ini.session.lazy-write) | Padrão `1`: só regrava a sessão se os dados mudaram. | **[modelo]** continua contando 2 acessos ao Redis por requisição (a 2ª vira atualização de validade). |
| [`session.use_strict_mode`](https://www.php.net/manual/en/session.configuration.php#ini.session.use-strict-mode) | Padrão `0`: aceita o ID enviado pelo cliente. | **[texto]** por isso o mesmo cookie recupera a sessão quando o Redis volta. |
| [`session_write_close()`](https://www.php.net/manual/en/function.session-write-close.php) | "Session data is locked to prevent concurrent writes only one script may operate on a session at any time." | **[não simulado]** trava de sessão. |
| [`session_start()`](https://www.php.net/manual/en/function.session-start.php) | Devolve `false` se não conseguir iniciar a sessão; desde o 7.1 não preenche `$_SESSION` nesse caso. | **[modelo]** Redis fora → resposta 200 **sem sessão**, sem erro. |
| [`opcache.enable`](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.enable) | Padrão `1`. | **[modelo]** ligado/desligado; custo de +120 ms quando desligado é **ilustrativo**. |
| [`opcache.validate_timestamps`](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.validate-timestamps), [`opcache.revalidate_freq`](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.revalidate-freq), [`opcache.memory_consumption`](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.memory-consumption) | Padrões `1`, `2` (s) e `128` (MB). | **[não simulado]** reconhecidos na leitura de configuração. |
| [`max_execution_time`](https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time) | Padrão `30`; **fora do Windows não conta o tempo em chamadas de sistema e operações de stream** (ex.: esperando o banco). | **[não simulado]**; por isso um script "parado" no banco não é interrompido por ele. |
| [`memory_limit`](https://www.php.net/manual/en/ini.core.php#ini.memory-limit) | Padrão `128M`. | **[não simulado]** |
| [`PDO::ERRMODE_EXCEPTION`](https://www.php.net/manual/en/pdo.error-handling.php) | "As of PHP 8.0.0, this is the default mode": o PDO lança `PDOException` em erro de conexão ou de consulta. | **[modelo]** erro do MySQL → exceção no PHP. |
| [`mysqli_report()`](https://www.php.net/manual/en/mysqli-driver.report-mode.php) | "As of PHP 8.1.0, the default setting is `MYSQLI_REPORT_ERROR \| MYSQLI_REPORT_STRICT`" (lança `mysqli_sql_exception`). Antes era `MYSQLI_REPORT_OFF`. | **[modelo]** idem para o mysqli. |
| [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) e [`php_error_cb` (`main/main.c`, PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/main/main.c) | Exceção não capturada vira erro `E_ERROR` "Uncaught …" ([`zend_exceptions.c`](https://github.com/php/php-src/blob/PHP-8.4/Zend/zend_exceptions.c)). Em `E_ERROR`, se `display_errors` está desligado, os cabeçalhos não foram enviados e o código ainda é 200, o PHP troca a resposta para `HTTP/1.0 500 Internal Server Error`. | **[modelo]** exceção do MySQL sem tratamento → **500**. Com `display_errors` ligado, a mensagem sai no corpo e o código pode ficar 200. |
| [Conexões persistentes](https://www.php.net/manual/en/features.persistent-connections.php) | No PHP-FPM e no mod_php, "any subsequent page served by the same child process can reuse the already established connection"; "idle workers still hold on to the connections they opened for previous requests"; após um pico, as conexões "will remain until the worker is terminated or the database server closes the connection". Recomenda que o limite do banco seja maior que o número de workers ("plus any other usage such as crons or administrative connections"). | **[modelo]** parâmetro "Conexões persistentes": uma conexão por worker (B) ou processo (A), solta só quando ele morre; cenário *Conexões persistentes*. |
| [`PDO::ATTR_PERSISTENT`](https://www.php.net/manual/en/pdo.connections.php), [mysqli `p:`](https://www.php.net/manual/en/mysqli.persistconns.php) | Como pedir conexão persistente no PDO e no mysqli; o mysqli limpa o estado da conexão (transações, locks, tabelas temporárias) ao reaproveitá-la. | **[texto]** balão do parâmetro. |
| [`mysqli.max_persistent`](https://www.php.net/manual/en/mysqli.configuration.php#ini.mysqli.max-persistent) | Padrão `-1` (sem limite) por processo. | **[não simulado]** reconhecido na leitura de configuração. |
| [Guia do Apache 2.x no manual](https://www.php.net/manual/en/install.unix.apache2.php) | "mod_php requires the prefork MPM unless PHP was compiled with thread safety (`--enable-zts`)"; recomenda PHP-FPM com o MPM event. | **[modelo]** arquitetura A = prefork + mod_php; B = event + PHP-FPM. |

## 2. PHP-FPM

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [Configuração do FPM (manual)](https://www.php.net/manual/en/install.fpm.configuration.php) | `pm` (static, dynamic, ondemand), `pm.max_children`, `pm.start_servers`, `pm.min/max_spare_servers`; `pm.max_spawn_rate` padrão **32**; `pm.process_idle_timeout` padrão **10s** (aceita s, m, h, d). | **[modelo]** todos esses parâmetros. |
| [`www.conf.in` (PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/sapi/fpm/www.conf.in) | Comentários com os padrões: `listen.backlog` "511 (-1 on Linux, FreeBSD and OpenBSD)", `pm.max_spawn_rate` 32, `pm.process_idle_timeout` 10s. | **[texto]** |
| [`fpm_sockets.h` (PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/sapi/fpm/fpm/fpm_sockets.h) | `FPM_BACKLOG_DEFAULT` = `-1` no Linux (o kernel trunca para `somaxconn`). | **[não simulado]** a fila do FPM não tem limite próprio no modelo. **Divergência:** o manual diz "511 (Linux and other platforms)"; o código diz -1 no Linux. Vale o código. |
| [`fpm_process_ctl.c` (PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/sapi/fpm/fpm/fpm_process_ctl.c), função `fpm_pctl_perform_idle_server_maintenance` | dynamic: se ociosos > `max_spare`, mata **um** (o de menor `started`) e a taxa volta a 1; se ociosos < `min_spare`, cria `min(idle_spawn_rate, min_spare − ociosos)` limitado por `max_children − running`, e a taxa dobra enquanto for < `pm.max_spawn_rate`; ao atingir `max_children`, conta "max children reached" uma vez por episódio e a taxa volta a 1. ondemand: mata **um** ocioso por passagem se passou de `process_idle_timeout`. `fpm_pctl_on_socket_accept`: no ondemand cria 1 filho por conexão pendente se não houver ocioso. | **[modelo]** `src/engine/fpm.js`. Diferença conhecida: ao remover no dynamic, o simulador escolhe o ocioso há mais tempo (o FPM escolhe o processo mais antigo). |
| [`request_terminate_timeout`](https://www.php.net/manual/en/install.fpm.configuration.php#request-terminate-timeout) | "The timeout for serving a single request after which the worker process will be killed"; "should be used when the 'max_execution_time' ini option does not stop script execution for some reason". Padrão 0 (desligado). | **[texto]** remédio para o worker que continua esperando o MySQL depois do 504; **[não simulado]**. |
| [`fpm_process_ctl.h` (PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/sapi/fpm/fpm/fpm_process_ctl.h) | `FPM_IDLE_SERVER_MAINTENANCE_HEARTBEAT (1000)`: a manutenção roda a cada 1 s. | **[modelo]** passos de 1 s. |
| [`session.c` (PHP 8.4)](https://github.com/php/php-src/blob/PHP-8.4/ext/session/session.c), `php_session_initialize` | Ordem: abre o armazenamento, valida/cria o ID, envia o cookie, lê. Falha na leitura: `E_WARNING "Failed to read session data"`, aborta a sessão **sem apagar os dados** e sem gravar no fim. | **[modelo]** Redis fora não zera a sessão; quando volta, a mesma sessão é lida. |

## 3. phpredis

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [README: PHP Session handler](https://github.com/phpredis/phpredis#php-session-handler) | Configuração por `session.save_handler = redis` e `session.save_path`; trava de sessão opcional (`redis.session.locking_enabled`). | **[modelo]** sessão no Redis; a trava não é simulada. |
| [`redis_session.c`](https://github.com/phpredis/phpredis/blob/develop/redis_session.c) | A conexão é feita na leitura; sem conexão emite `E_WARNING "Redis connection not available"` e devolve falha, **sem lançar exceção**. | **[modelo]** Redis fora → 200 sem sessão. |

## 4. Apache httpd 2.4

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [MPM event](https://httpd.apache.org/docs/2.4/mod/event.html) | Keep-alive ocioso e *write completion* podem ser passados à thread listener; mas em conteúdo **FCGI/CGI/proxy** "a worker thread has to finish its work before returning the control to the listener". | **[modelo]** a thread fica ocupada enquanto espera o FPM. **[texto]** com Apache, o cliente lento também prende a thread (a arquitetura B do simulador supõe o caso ideal, como nginx com buffering). |
| [MPM prefork](https://httpd.apache.org/docs/2.4/mod/prefork.html) | Um processo por conexão, sem threads. | **[modelo]** arquitetura A. |
| [`MaxRequestWorkers`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#maxrequestworkers) | Limite de requisições simultâneas; acima dele as conexões ficam na fila até o limite de `ListenBacklog`. No prefork, padrão 256. | **[modelo]** parâmetro "Apache: máximo de requisições simultâneas". |
| [`ListenBacklog`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#listenbacklog) | Padrão **511**. | **[modelo]** fila do Apache de até 511 por backend; acima disso o simulador marca 503 (no Linux real, ver §7). |
| [`ServerLimit`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#serverlimit), [`ThreadsPerChild`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#threadsperchild) | Limites de processos e threads por processo. | **[modelo]** leitura de configuração: `ServerLimit × ThreadsPerChild` quando falta `MaxRequestWorkers`. |
| [`Timeout`](https://httpd.apache.org/docs/2.4/mod/core.html#timeout) | Padrão **60** s. | **[texto]** balão do timeout. |
| [`KeepAlive`](https://httpd.apache.org/docs/2.4/mod/core.html#keepalive), [`KeepAliveTimeout`](https://httpd.apache.org/docs/2.4/mod/core.html#keepalivetimeout) | Padrões `On` e **5** s. | **[texto]** no prefork o keep-alive prende o processo; não simulado. |
| [`ProxyTimeout`](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxytimeout) | Padrão: o valor de `Timeout`. | **[texto]** timeout do Apache esperando o FPM. |
| [`ProxyPass`, parâmetro `retry`](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass) | `retry` padrão **60**: com o backend em erro, o Apache não encaminha requisições a ele até o prazo vencer. | **[não simulado]** (ver [roadmap](roadmap.md)). |
| [`mod_proxy_fcgi`](https://httpd.apache.org/docs/2.4/mod/mod_proxy_fcgi.html) | Módulo FastCGI do proxy (Apache → PHP-FPM). | **[modelo]** arquitetura B. |

## 5. nginx

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [`ip_hash`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#ip_hash) | Usa os **três primeiros octetos do IPv4** (ou o IPv6 inteiro) como chave; para tirar um servidor preservando o mapeamento, marcá-lo `down`. | **[texto]** o "sticky" do simulador é por usuário e remapeia por módulo (comportamento do HAProxy map-based, ver §6). |
| [`server` (`max_fails`, `fail_timeout`, `down`)](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server) | Detecção passiva de falha: `max_fails` (padrão 1) em `fail_timeout` (padrão 10 s). | **[texto]** parâmetro "Tempo até o balanceador notar". |
| [`proxy_next_upstream`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream) | Padrão `error timeout`: passa a requisição ao próximo servidor; requisições não idempotentes (POST…) não são repetidas se já foram enviadas. | **[texto]** o simulador não repete; com nginx o cliente quase não veria o 502 de conexão recusada. |
| [`fastcgi_read_timeout`](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_read_timeout) | Padrão **60s**, contado "only between two successive read operations". | **[texto]** o simulador usa um limite de espera total. |
| [`fastcgi_buffering`](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_buffering), [`fastcgi_max_temp_file_size`](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_max_temp_file_size) | Padrão `on`; o excedente vai para arquivo temporário (até 1024m). | **[modelo]** a arquitetura B supõe esse comportamento: o worker do FPM é liberado antes do envio ao cliente lento. |

## 6. HAProxy 2.8

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [`retries`](https://docs.haproxy.org/2.8/configuration.html#4.2-retries) | Novas tentativas **no mesmo servidor**; por padrão só para novas conexões. | **[texto]** |
| [`retry-on`](https://docs.haproxy.org/2.8/configuration.html#4.2-retry-on) | Padrão `conn-failure`; aceita também `empty-response`, `response-timeout`, códigos HTTP etc. | **[texto]** |
| [`option redispatch`](https://docs.haproxy.org/2.8/configuration.html#4-option%20redispatch) | Permite que uma nova tentativa vá a **outro** servidor; por padrão só na última tentativa. | **[texto]** sem ela, o HAProxy não troca de servidor ao repetir. |
| [`inter`](https://docs.haproxy.org/2.8/configuration.html#5.2-inter), [`fall`](https://docs.haproxy.org/2.8/configuration.html#5.2-fall), [`rise`](https://docs.haproxy.org/2.8/configuration.html#5.2-rise) | Verificação ativa a cada 2000 ms; servidor morto após 3 falhas e vivo após 2 sucessos. | **[texto]** detecção ≈ `inter × fall` ≈ 6 s; o simulador usa 4 s por padrão e o mesmo prazo na volta. |
| [`hash-type`](https://docs.haproxy.org/2.8/configuration.html#4.2-hash-type) | `map-based` (padrão): quando um servidor cai ou volta, "most connections will be redistributed". | **[modelo]** o sticky remapeia por módulo, como o map-based. |

## 7. Linux e TCP

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [`listen(2)`](https://man7.org/linux/man-pages/man2/listen.2.html) | O backlog é limitado por `/proc/sys/net/core/somaxconn`: **4096 desde o Linux 5.4** (128 antes). | **[texto]** explica o 4096 visto no `fpm-status`. |
| [`tcp_abort_on_overflow`](https://docs.kernel.org/networking/ip-sysctl.html) | Padrão `FALSE`: com a fila cheia, a conexão não é resetada e "will recover" (o cliente retransmite). | **[texto]** por isso, no real, fila cheia vira retransmissão e demora, não um 503 imediato. |
| [`connect(2)`](https://man7.org/linux/man-pages/man2/connect.2.html) | `EAGAIN`: em socket Unix não bloqueante, a conexão não pôde ser completada na hora (fila cheia). | **[texto]** com socket Unix cheio, o nginx registra `(11: Resource temporarily unavailable)` e devolve 502. |

## 8. Códigos HTTP ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html))

| Código | Definição | Quem gera, no simulador e no real |
|---|---|---|
| [500](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.1) | Condição inesperada no servidor. | Só com MySQL: exceção do PDO/mysqli sem tratamento (1040, 2002, 1205, 2013; ver §1 e §10). Redis fora continua dando 200 sem sessão. |
| [502](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.3) | O gateway/proxy recebeu resposta inválida do servidor de trás. | Backend caído (conexão recusada ou interrompida). No nginx, quando nenhum servidor pode ser escolhido, [`$upstream_status`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_status) fica com 502. |
| [503](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4) | Sobrecarga temporária ou manutenção. | Fila do Apache cheia (no real: retransmissões, ver §7). No HAProxy, "503 when no server was available to handle the request" ([§1.3.1](https://docs.haproxy.org/2.8/configuration.html#1.3.1)). |
| [504](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.5) | O gateway/proxy não recebeu resposta a tempo. | Tempo de espera pelo PHP esgotado. Com MySQL, o PHP pode continuar esperando o banco depois do 504 (requisição "fantasma"). |

## 9. Frameworks: o que acontece quando a sessão ou o Redis falha

O simulador segue o **PHP puro** (aviso, 200 sem sessão). Frameworks mudam isso:

| Framework | O que o código ou a documentação oficial mostram | Resultado provável |
|---|---|---|
| Laravel 12 | [`HandleExceptions::handleError`](https://github.com/laravel/framework/blob/12.x/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php) lança `ErrorException` para todo erro que não seja *deprecation* e esteja em `error_reporting`. A [sessão](https://laravel.com/docs/12.x/session) usa o próprio driver (pode ser Redis). | Aviso vira exceção → **500**. |
| Symfony | [`framework.php_errors.throw`](https://symfony.com/doc/current/reference/configuration/framework.html#throw) tem padrão `%kernel.debug%`: "Throw PHP errors as \ErrorException instances". A [documentação de sessão](https://symfony.com/doc/current/session.html) cita o `RedisSessionHandler`. | Em debug → **500**; em produção o aviso é registrado no log e a página segue. |

Em ambos, o resultado final depende de como a aplicação trata a falha (ex.: capturar a exceção e seguir sem sessão).

## 10. MySQL 8.4

Manual de referência do MySQL 8.4 (LTS) e referência de erros.

| Item | O que a fonte diz | No simulador |
|---|---|---|
| [`max_connections`](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_connections) | "The maximum permitted number of simultaneous client connections". Padrão **151** (1 a 100000). | **[modelo]** parâmetro `max_connections`. |
| [Too many connections](https://dev.mysql.com/doc/refman/8.4/en/too-many-connections.html) | Com todas as conexões em uso, o cliente recebe `Too many connections`. O servidor aceita `max_connections + 1`: a extra é reservada para contas com `CONNECTION_ADMIN`, para o administrador rodar `SHOW PROCESSLIST`. | **[modelo]** acima do limite → 1040 → 500. A conexão extra do administrador não é simulada. |
| [ER_CON_COUNT_ERROR](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html#error_er_con_count_error) | Erro **1040**, SQLSTATE `08004`, "Too many connections". | **[modelo]** contador "MySQL 1040". |
| [`Max_used_connections`](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Max_used_connections), [`Connection_errors_max_connections`](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Connection_errors_xxx), [`Threads_connected`](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Threads_connected) | "The maximum number of connections that have been in use simultaneously since the server started"; "The number of connections refused because the server `max_connections` limit was reached"; "The number of currently open connections". | **[modelo]** "pico de conexões", "MySQL 1040" e "conexões MySQL" no painel. |
| [Connection Interfaces](https://dev.mysql.com/doc/refman/8.4/en/connection-interfaces.html) | Cada conexão de cliente tem uma thread dedicada: "there are as many threads as there are clients currently connected". | **[texto]** por isso cada conexão custa memória e o limite existe. |
| [`innodb_thread_concurrency`](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_thread_concurrency) | Padrão **0**, "interpreted as infinite concurrency (no limit)"; "Threads waiting for locks are not counted". | **[modelo, simplificado]** o MySQL do simulador executa no máximo *núcleos* consultas ao mesmo tempo e enfileira as outras (FIFO). No real não há essa fila: as threads disputam CPU e disco, e o efeito é parecido (vazão limitada, latência crescente). Quem espera lock não ocupa núcleo, como no real. |
| [`innodb_lock_wait_timeout`](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_lock_wait_timeout) | Padrão **50** s: "The length of time in seconds an InnoDB transaction waits for a row lock before giving up", com `ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction`; desfaz só o comando, não a transação; "applies to InnoDB row locks", não a locks de tabela. | **[modelo]** parâmetro `innodb_lock_wait_timeout` e cenário *Lock*. |
| [ER_LOCK_WAIT_TIMEOUT](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html#error_er_lock_wait_timeout) | Erro **1205**, SQLSTATE `HY000`. | **[modelo]** contador "MySQL 1205". |
| [Locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) | `SELECT ... FOR UPDATE` trava as linhas como um `UPDATE`; "Consistent reads ignore any locks set on the records". | **[texto]** só escritas (e leituras com trava) esperam o lock; por isso o cenário diz que toda requisição **atualiza** a mesma linha. O simulador trava todas as consultas. |
| [`lock_wait_timeout`](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lock_wait_timeout), [Metadata Locking](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html) | Tempo para obter **metadata locks** (DDL como `ALTER TABLE`, `LOCK TABLES`…): padrão **31536000** s (1 ano). | **[texto]** diferença entre lock de linha e metadata lock no cenário *Lock*; **[não simulado]**. |
| [Erros do cliente](https://dev.mysql.com/doc/mysql-errors/8.4/en/client-error-reference.html) | [2002](https://dev.mysql.com/doc/mysql-errors/8.4/en/client-error-reference.html#error_cr_connection_error) `CR_CONNECTION_ERROR` "Can't connect to local MySQL server through socket"; [2003](https://dev.mysql.com/doc/mysql-errors/8.4/en/client-error-reference.html#error_cr_conn_host_error) `CR_CONN_HOST_ERROR` (o mesmo por TCP); [2006](https://dev.mysql.com/doc/mysql-errors/8.4/en/client-error-reference.html#error_cr_server_gone_error) "MySQL server has gone away"; [2013](https://dev.mysql.com/doc/mysql-errors/8.4/en/client-error-reference.html#error_cr_server_lost) "Lost connection to MySQL server during query". | **[modelo]** MySQL fora: nova conexão → **2002** (por TCP seria 2003; o simulador usa um código só); consulta em andamento → **2013**. |
| [`wait_timeout`](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_wait_timeout) | Padrão **28800** s (8 h) para fechar conexão ociosa. | **[não simulado]**; por isso, no cenário *Conexões persistentes*, as conexões ociosas ficam abertas por horas. |
| [Índices](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html) | "Without an index, MySQL must begin with the first row and then read through the entire table to find the relevant rows. The larger the table, the more this costs." | **[texto]** cenário *Consulta sem índice* (o valor de 150 ms é ilustrativo). |
| [`EXPLAIN`](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html), [Slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html) | Como ver o plano da consulta; o log lento registra consultas que levam mais que `long_query_time` (padrão 10 s). | **[texto]** onde investigar no real. |

## 11. Fontes complementares (não oficiais, confiáveis)

| Fonte | O que sustenta |
|---|---|
| J. D. C. Little, "A Proof for the Queuing Formula: L = λW", *Operations Research* 9(3):383–387, 1961, DOI `10.1287/opre.9.3.383` (artigo original; sem link porque o editor bloqueia acesso automatizado) | L = λW: itens em atendimento = chegada × tempo. É a conta dos textos dos cenários ("4 req/s × 0,8 s = 3,2 workers", "conexões ≈ req/s × tempo segurando a conexão") e a capacidade do MySQL = núcleos / (consultas × tempo). |
