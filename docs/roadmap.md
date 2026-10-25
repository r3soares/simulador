# Roadmap

Melhorias e pendências conhecidas. Cada mudança de modelo deve vir com teste e com a fonte em [referencias.md](referencias.md).

## Modelo

- [ ] **Partida de worker inconsistente:** no dynamic o worker criado fica pronto na hora; no ondemand leva 200 ms. Usar o mesmo custo nos dois.
- [ ] **Nova tentativa no balanceador:** opção para imitar o nginx (`proxy_next_upstream`: refaz em outro servidor) e o HAProxy (`retries` no mesmo servidor, `option redispatch`). Hoje o cliente vê 502 que, com esses padrões, não veria.
- [ ] **Fila do FPM com limite** (`listen.backlog` = `somaxconn`) e o comportamento com ela cheia (socket Unix: nginx 502).
- [ ] **Apache com o backend FCGI em erro:** o `mod_proxy` deixa de encaminhar por `retry` (60 s). O código HTTP devolvido (provavelmente 503) **não foi verificado** em fonte oficial.
- [ ] **Cliente lento com Apache:** variante da arquitetura B em que a thread (e, em respostas grandes, o worker) fica presa até o fim do envio.
- [ ] **Sessão no Redis:** expiração por `session.gc_maxlifetime` e Redis que volta sem os dados (sem persistência).
- [ ] **Trava de sessão:** requisições simultâneas do mesmo usuário esperam uma pela outra.
- [ ] **Requisições abandonadas:** o FPM provavelmente executa conexões que o cliente já abandonou (trabalho desperdiçado). Não verificado.
- [ ] **Keep-alive** no prefork prendendo o processo (`KeepAliveTimeout` 5 s).
- [ ] **Sticky como o nginx `ip_hash`:** servidor que falha só desvia os próprios usuários.

### MySQL

- [ ] **Host inalcançável:** hoje o MySQL fora recusa a conexão na hora (2002). Se o servidor some da rede, o `connect` espera o tempo limite (PDO `ATTR_TIMEOUT`, `default_socket_timeout`) e os workers ficam presos. Opção "recusa × some da rede".
- [ ] **Fantasma também no `exec`:** aplicar a mesma regra do banco (504 na hora, worker preso até o fim) ao PHP sem banco. Mudaria os cenários antigos.
- [ ] **`request_terminate_timeout`:** matar o worker que passou do limite, remédio para os fantasmas.
- [ ] **Escolha do worker ocioso:** hoje o FPM simulado entrega ao primeiro da lista. Verificar no kernel/FPM qual worker aceita a conexão; com conexões persistentes, uma distribuição mais espalhada abre mais conexões.
- [ ] **Réplica de leitura** e atraso de replicação (ler logo depois de gravar e não achar o dado).
- [ ] **Pool de conexões** (ProxySQL, MySQL Router) entre o PHP e o banco.
- [ ] **`wait_timeout`** fechando conexões persistentes ociosas e o "MySQL server has gone away" (2006) na próxima consulta.
- [ ] **Lock só para escritas:** separar leituras (não esperam) de escritas no cenário de lock.
- [ ] **Deadlock** (`innodb_deadlock_detect`: uma das transações recebe 1213 na hora).

## Interface

- [ ] Canvas pequeno demais para ler em celulares (390 px).
- [ ] No cenário "Escala", as bolinhas em trânsito cobrem rótulos.

## Verificação em container (labs)

- [ ] A3: cliente lento com Apache + PHP-FPM (`curl --limit-rate` com resposta grande).
- [ ] F6: `ondemand` reduzindo workers, sem polling no `pm.status_path`.
- [ ] N7: socket Unix com a fila cheia.
- [ ] Lab 06: nginx mandando tudo ao app1 logo após subir.
- [ ] M9: nginx/Apache devolve 504 e o worker do FPM continua preso no `SELECT ... FOR UPDATE` até o 1205.
- [ ] M4: PHP-FPM `pm = static` com `PDO::ATTR_PERSISTENT` e `Threads_connected` depois de um pico (`ab`/`wrk`).

## Fora do simulador (arquivos dos labs)

- `labs/02-nginx-fpm/EXPERIMENTS.md`, item 4: sem `SCRIPT_FILENAME`, fontes secundárias indicam "No input file specified." ("File not found." apareceria quando o arquivo não existe). Não verificado.
- `labs/06-load-balancer`: `ip_hash` usa o /24 do IPv4, não o IP inteiro.
- `labs/05-apache/EXPERIMENTS.md`: "mod_php exige prefork" vale só sem ZTS.
- `labs/03-fpm-pools`: com `min_spare = 1`, o dynamic cria 1 worker por segundo, não 1, 2, 4, 8.
