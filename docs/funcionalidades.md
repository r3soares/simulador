# Funcionalidades

O que a página `dist/simulador.html` oferece, de cima para baixo. Como cada parte funciona por dentro está em [modelo.md](modelo.md); as fontes de cada afirmação técnica estão em [referencias.md](referencias.md).

## 1. Cenários prontos

Catorze situações típicas, em três categorias. Clicar num cenário aplica os parâmetros dele (sobre uma base comum: round-robin, Redis 5 ms, cliente lento 3 s, `min_spare` 1, `max_spare` 3, timeout 30 s, detecção 4 s, `start_servers` 2, `idle_timeout` 6 s), reinicia a simulação, religa o Redis e mostra o texto explicativo. Os textos estão em `src/model/presets.js`, e o que cada um promete é conferido em `test/engine/presets.test.js`.

| Categoria | Cenário | O que mostra |
|---|---|---|
| Mais comuns | **Pool saturado** | 4 req/s × 0,8 s pedem 3,2 workers, mas só há 2: a fila do FPM cresce e, depois de cerca de 1 min e meio, vêm os 504. |
| | **Dependência lenta** | Botões *Banco ficou lento* (PHP 0,2 s → 2 s) e *Banco voltou ao normal*: o pool satura, vêm 504 e 503, a vazão de sucesso despenca e depois se recupera. |
| | **Timeout curto** | Com timeout de 5 s e pool saturado, as requisições que chegam a um worker já estão quase expiradas: a vazão de sucesso cai a quase zero. |
| | **Backend cai (failover)** | 3 backends em rodízio; derrubar o app2 dá 502 em ~1/3 das novas requisições até o balanceador notar. |
| Comuns | **Gargalo nas threads do Apache** | Apache com 4 requisições simultâneas e FPM com 16 workers: o menor limite manda. |
| | **Sessões em 3 backends** | Sessão em arquivo local + round-robin perde sessões; sticky ou Redis resolvem. |
| | **Sticky e a queda de um backend** | Sticky não perde sessão até um backend cair; aí os usuários dele perdem (e o remapeamento por módulo move outros). |
| | **Sessão no Redis** | Redis compartilhado não perde sessão; derrubar o Redis dá 200 **sem sessão** (PHP puro). |
| | **OPcache desligado** | +120 ms por requisição (ilustrativo) bastam para saturar 2 workers a 12 req/s. |
| | **Pico no modo dynamic** | Com `min_spare` 1, o pool cresce 1 worker por segundo durante a rajada e depois volta a `max_spare`. |
| Didáticos | **Cliente lento: prefork** | No prefork + mod_php, o processo fica preso até entregar a resposta ao cliente lento. |
| | **Cliente lento: event + FPM** | Caso ideal (servidor web com buffering, como o nginx): o worker do FPM é liberado. O texto explica que o Apache com `mod_proxy_fcgi` **não** faz isso. |
| | **ondemand: partida a frio** | O pool começa vazio, cria workers sob demanda e os remove um por segundo depois do `process_idle_timeout`. |
| | **Escala: 512 workers** | 500 req/s cabem; a 750 req/s (capacidade 640) aparecem os 503. |

## 2. Ações

| Botão | Efeito |
|---|---|
| **Rajada de 20 requisições** | Cria 20 requisições de uma vez (usuários sorteados). |
| **Pausar / Continuar** | Congela o tempo simulado. |
| **Reiniciar** | Zera tempo, contadores, filas e sessões, mantendo os parâmetros. |
| **Derrubar / Subir Redis** | Liga e desliga o Redis. |
| **Derrubar / Subir appN** | Liga e desliga cada backend. Ao derrubar, tudo o que estava nele (fila, execução, envio) falha com 502; o balanceador só deixa de usá-lo (e volta a usá-lo) depois do tempo de detecção. |

## 3. Estado

Atualizado a cada 250 ms: em andamento, concluídas, erros, vazão (média dos últimos 5 s), latência média e p95 (últimas 200 respostas), sessões perdidas, **respostas 200 sem sessão** (só quando houver) e um quadro por código de erro com o significado.

## 4. Simulação (canvas)

- **Bolinha** = requisição, na cor do usuário (U1 a U6). **Anel** ao redor = cliente lento. **Bolinha vazada** = resposta sem sessão. Vermelha com código = erro.
- Cada backend mostra as threads (event) ou os processos (prefork) do Apache, os workers do PHP-FPM (quadrado tracejado = iniciando, no ondemand), as duas filas com o tamanho real, o contador "limite atingido" do `max_children` e as sessões em arquivo guardadas ali.
- Acima de 24 unidades os quadrados ficam menores; acima de 144, cada quadrado agrupa várias unidades e a cor mostra a fração ocupada. As filas desenham só as primeiras bolinhas (o número exato aparece no texto).
- A altura é fixa (cabem 3 backends) e o desenho acompanha a largura e o `devicePixelRatio` da tela.
- Legenda dos códigos: 502 (backend caído), 502/503 (nenhum backend disponível), 503 (fila de conexões do Apache cheia), 504 (tempo esgotado esperando o PHP). Ver [referencias.md §8](referencias.md#8-códigos-http-rfc-9110).

## 5. Sessões dos 6 usuários

Aparece só quando há sessão (arquivo ou Redis). Colunas:

| Coluna | Significado |
|---|---|
| sessão | Requisições seguidas que encontraram a sessão; volta a 0 quando ela se perde. |
| guardada em | `arquivo em appN` ou `Redis`, com aviso se o servidor ou o Redis está fora do ar. |
| última requisição | Servidor, há quanto tempo, e o resultado: sessão criada, encontrada, **perdida (estava em appN)** ou **não lida (Redis fora): resposta 200, usuário aparece deslogado**. |
| perdas | Quantas vezes a sessão daquele usuário se perdeu. Redis fora **não** conta como perda: os dados continuam lá e voltam quando o Redis volta. |

A linha fica vermelha por ~1,5 s quando a sessão acabou de se perder ou não ser lida.

## 6. Carregar configuração

Aceita vários arquivos de uma vez (`php.ini`, pool do FPM, `httpd.conf`, `mpm_*.conf`, `httpd-mpm.conf`). A leitura acontece no navegador, nada é enviado. O relatório separa **Aplicado**, **Reconhecido, mas não simulado** e **Avisos**, e a simulação reinicia com os valores aplicados.

| Arquivo | Chaves lidas | Observações |
|---|---|---|
| Pool do FPM | `pm`, `pm.max_children`, `pm.start_servers`, `pm.min_spare_servers`, `pm.max_spare_servers`, `pm.process_idle_timeout` (com sufixos s/m/h/d) | Usa o primeiro pool e avisa se houver mais. Aceita `php_value[...]`/`php_admin_value[...]`. |
| `php.ini` | `opcache.enable`, `session.save_handler` | `files` → arquivo; `redis` → Redis; `memcached`/`memcache` → compartilhado (com aviso). |
| Apache | MPM (`LoadModule` ou bloco `<IfModule mpm_*>`), `MaxRequestWorkers`/`MaxClients`, ou `ServerLimit × ThreadsPerChild` | `prefork` → arquitetura A; `event`/`worker` → B. Linhas com `#` são ignoradas. Com vários blocos `<IfModule>`, usa o do MPM carregado (o `LoadModule` pode vir de outro arquivo enviado junto); sem `LoadModule`, usa o primeiro e avisa. |
| Não simulados | `memory_limit`, `max_execution_time`, `request_terminate_timeout`, `listen.backlog`, `pm.max_requests`, `pm.status_path`, `opcache.memory_consumption`, `opcache.validate_timestamps`, `opcache.jit`, `opcache.max_accelerated_files` | Listados no relatório. |

Valores fora da lista de um controle viram o mais próximo (com aviso), por exemplo `pm.max_children = 7` → 6.

## 7. Parâmetros

Mudar arquitetura, backends, limite do Apache, `max_children`, `pm` ou `start_servers` reinicia a simulação; os demais valem na hora. Parâmetros que não se aplicam à configuração atual ficam desabilitados. Cada um tem um balão **?** com o texto abaixo.

### Servidor web e balanceador

| Parâmetro | Valores | Balão | Referência |
|---|---|---|---|
| `arch` Arquitetura | B · Apache event + PHP-FPM / A · Apache prefork + mod_php | Como o PHP roda: dentro do processo do Apache (prefork + mod_php) ou em um serviço separado (Apache event + PHP-FPM). | [mod_php e prefork](https://www.php.net/manual/en/install.unix.apache2.php), [MPM event](https://httpd.apache.org/docs/2.4/mod/event.html), [MPM prefork](https://httpd.apache.org/docs/2.4/mod/prefork.html) |
| `nb` Backends | 1, 2, 3 | Servidor de aplicação (Apache + PHP) que fica atrás do balanceador e recebe uma parte das requisições. | — |
| `lb` Balanceamento (com 2+ backends) | round-robin / sticky / menos conexões | Como o balanceador escolhe o backend: em rodízio, sempre o mesmo para o mesmo cliente (sticky) ou o menos ocupado. | [nginx `ip_hash`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#ip_hash), [HAProxy `hash-type`](https://docs.haproxy.org/2.8/configuration.html#4.2-hash-type) |
| `T` Apache: máximo de requisições simultâneas | 1…600 | MaxRequestWorkers: no event cada requisição usa uma thread; no prefork, um processo inteiro (com o PHP dentro). | [`MaxRequestWorkers`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#maxrequestworkers), [`ListenBacklog`](https://httpd.apache.org/docs/2.4/mod/mpm_common.html#listenbacklog) |

### PHP-FPM (arquitetura B)

| Parâmetro | Valores | Balão | Referência |
|---|---|---|---|
| `pm` | static / dynamic / ondemand | static: número fixo. dynamic: cresce e encolhe entre limites. ondemand: cria quando chega requisição e remove os ociosos. | [Configuração do FPM](https://www.php.net/manual/en/install.fpm.configuration.php) |
| `W` pm.max_children | 1…512 | Máximo de scripts PHP rodando ao mesmo tempo; passou disso, as requisições esperam na fila. | idem |
| `start` pm.start_servers (dynamic) | 1…64 | Quantos workers existem na partida. | idem |
| `minSpare` pm.min_spare_servers (dynamic) | 1…32 | Mínimo de ociosos; abaixo disso o FPM cria mais, aumentando o ritmo a cada segundo. | idem, [`fpm_process_ctl.c`](https://github.com/php/php-src/blob/PHP-8.4/sapi/fpm/fpm/fpm_process_ctl.c) |
| `maxSpare` pm.max_spare_servers (dynamic) | 1…64 | Máximo de ociosos; acima disso o FPM remove um por vez. | idem |
| `idleTimeout` pm.process_idle_timeout (ondemand) | 1…60 s | Tempo ocioso depois do qual um worker é removido. | idem |

### Aplicação PHP

| Parâmetro | Valores | Balão | Referência |
|---|---|---|---|
| `exec` Duração do PHP | 50…3000 ms | Quanto tempo o script leva (consultas, APIs, cálculo); ocupa um worker o tempo todo. Cada execução varia ±15%. | — |
| `opcache` | ligado / desligado | Desligado, cada requisição recompila os arquivos (+120 ms, valor ilustrativo). | [`opcache.enable`](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.enable) |
| `session` Sessão | sem sessão / arquivo local / Redis | Arquivo no próprio backend (se a próxima requisição cair em outro, a sessão se perde) ou Redis compartilhado. | [`session.save_handler`](https://www.php.net/manual/en/session.configuration.php#ini.session.save-handler), [phpredis](https://github.com/phpredis/phpredis#php-session-handler) |
| `redisMs` Latência do Redis (Redis) | 1…100 ms | Tempo de cada acesso; cada requisição faz dois (ler e gravar). | [`session.lazy_write`](https://www.php.net/manual/en/session.configuration.php#ini.session.lazy-write) |

### Carga e clientes

| Parâmetro | Valores | Balão | Referência |
|---|---|---|---|
| `rate` Requisições por segundo | 0…1000 | A carga; a chegada é aleatória (Poisson), com essa média. | — |
| `slowPct` Clientes lentos | 0…100 % | Clientes com conexão lenta ou resposta grande. | [MPM event (limitações)](https://httpd.apache.org/docs/2.4/mod/event.html), [`fastcgi_buffering`](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_buffering) |
| `slowMs` Tempo para o cliente lento receber | 500…8000 ms | Quanto tempo esses clientes levam para receber a resposta. | — |

### Timeouts e falhas

| Parâmetro | Valores | Balão | Referência |
|---|---|---|---|
| `timeout` Timeout do servidor web | 5…120 s | Tempo máximo de espera pelo PHP; passou disso, 504. No real o padrão costuma ser 60 s. Com mod_php o Apache não gera 504 (seria o balanceador) e o PHP para em `max_execution_time`. | [`fastcgi_read_timeout`](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_read_timeout), [`ProxyTimeout`](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxytimeout), [`Timeout`](https://httpd.apache.org/docs/2.4/mod/core.html#timeout), [`max_execution_time`](https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time) |
| `detect` Tempo até o balanceador notar backend caído | 0…10 s | Nesse intervalo ele ainda envia requisições ao backend morto (502). Aqui não há nova tentativa; o nginx refaz em outro backend por padrão; o HAProxy repete no mesmo servidor e só muda com `option redispatch`. | [`proxy_next_upstream`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream), [nginx `max_fails`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server), [HAProxy `inter`/`fall`](https://docs.haproxy.org/2.8/configuration.html#5.2-inter), [`retries`](https://docs.haproxy.org/2.8/configuration.html#4.2-retries), [`option redispatch`](https://docs.haproxy.org/2.8/configuration.html#4-option%20redispatch) |

### Simulação

| Parâmetro | Valores | Efeito |
|---|---|---|
| `speed` Velocidade | 0,1x … 4x | Multiplica o tempo simulado por quadro. |
