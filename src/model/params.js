// Parâmetros da simulação: valores padrão, controles da interface, grupos e quando cada um se aplica.
export const DEFAULTS = { arch:'B', nb:1, lb:'rr', T:8, W:4, pm:'static', exec:800, opcache:'on', slowPct:0, slowMs:3000, session:'none', redisMs:5, rate:3, speed:1, minSpare:1, maxSpare:3, timeout:30, detect:4, start:2, idleTimeout:6 };
export const TVALS = [1,2,3,4,5,6,8,10,12,15,16,20,24,25,32,48,50,64,75,100,128,150,200,256,300,400,500,512,600];
export const WVALS = [1,2,3,4,5,6,8,10,12,16,20,24,30,32,40,48,50,64,80,100,128,150,200,256,300,400,500,512];
export const RATEVALS = [0,1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100,150,200,300,400,500,750,1000];

// struct: mudar o parâmetro reinicia a simulação
export const PARAMS = [
  { k:'arch', tip:"Como o PHP roda: dentro do processo do Apache (prefork + mod_php) ou em um serviço separado (Apache event + PHP-FPM).", label:'Arquitetura', opts:[['B','B · Apache event + PHP-FPM'], ['A','A · Apache prefork + mod_php']], struct:1 },
  { k:'nb', tip:"Servidor de aplicação (Apache + PHP) que fica atrás do balanceador e recebe uma parte das requisições.", label:'Backends', opts:[['1','1 backend'], ['2','2 backends'], ['3','3 backends']], struct:1 },
  { k:'lb', tip:"Como o balanceador escolhe o backend: em rodízio (round-robin), sempre o mesmo para o mesmo cliente (sticky) ou o menos ocupado. Só vale com 2 ou mais backends.", label:'Balanceamento', opts:[['rr','round-robin'], ['ip','sticky (mesmo cliente, mesmo backend)'], ['lc','menos conexões']] },
  { k:'T', tip:"MaxRequestWorkers: quantas requisições o Apache atende ao mesmo tempo. No event cada uma usa uma thread; no prefork, um processo inteiro (com o PHP dentro).", label:'Apache: máximo de requisições simultâneas', vals:TVALS, struct:1 },
  { k:'W', tip:"pm.max_children: máximo de workers do PHP-FPM, isto é, de scripts PHP rodando ao mesmo tempo. Passou disso, as requisições esperam na fila.", label:'pm.max_children', vals:WVALS, struct:1 },
  { k:'pm', tip:"pm: como o FPM gerencia os workers. static: número fixo. dynamic: cresce e encolhe entre limites. ondemand: cria quando chega requisição e remove os ociosos.", label:'pm (modo do pool)', opts:[['static','static'], ['dynamic','dynamic'], ['ondemand','ondemand']], struct:1 },
  { k:'start', tip:"pm.start_servers: quantos workers existem na partida (modo dynamic).", label:'pm.start_servers', min:1, max:64, step:1, struct:1 },
  { k:'minSpare', tip:"pm.min_spare_servers: mínimo de workers ociosos. Abaixo disso o FPM cria mais, aumentando o ritmo a cada segundo (modo dynamic).", label:'pm.min_spare_servers', min:1, max:32, step:1 },
  { k:'maxSpare', tip:"pm.max_spare_servers: máximo de workers ociosos. Acima disso o FPM remove um por vez (modo dynamic).", label:'pm.max_spare_servers', min:1, max:64, step:1 },
  { k:'idleTimeout', tip:"pm.process_idle_timeout: tempo ocioso depois do qual um worker é removido (modo ondemand).", label:'pm.process_idle_timeout (s)', min:1, max:60, step:1 },
  { k:'exec', tip:"Quanto tempo o script PHP leva (consultas, APIs, cálculo). Ele ocupa um worker durante todo esse tempo.", label:'Duração do PHP (ms)', min:50, max:3000, step:50 },
  { k:'opcache', tip:"O OPcache guarda o código já compilado em memória. Desligado, cada requisição recompila os arquivos (aqui +120 ms, valor ilustrativo).", label:'OPcache', opts:[['on','ligado'], ['off','desligado']] },
  { k:'slowPct', tip:"Percentual de clientes com conexão lenta ou resposta grande, que demoram para receber a resposta.", label:'Clientes lentos (%)', min:0, max:100, step:10 },
  { k:'slowMs', tip:"Quanto tempo esses clientes lentos levam para receber a resposta.", label:'Tempo para o cliente lento receber (ms)', min:500, max:8000, step:500 },
  { k:'session', tip:"Onde ficam as sessões: nenhuma, em arquivo no próprio backend (se a próxima requisição cair em outro, a sessão se perde) ou em um Redis compartilhado.", label:'Sessão', opts:[['none','sem sessão'], ['file','arquivo local do backend'], ['redis','Redis compartilhado']] },
  { k:'redisMs', tip:"Tempo de cada acesso ao Redis. Cada requisição faz dois (ler e gravar a sessão).", label:'Latência do Redis (ms)', min:1, max:100, step:1 },
  { k:'rate', tip:"Requisições chegando por segundo (a carga). A chegada é aleatória, com essa média.", label:'Requisições por segundo', vals:RATEVALS },
  { k:'timeout', tip:"Tempo máximo de espera pelo PHP (como fastcgi_read_timeout no nginx ou ProxyTimeout/Timeout no Apache com FPM). Passou disso, a requisição recebe 504. Nos servidores reais o padrão costuma ser 60 s. Com mod_php (arquitetura A) o Apache não gera 504: quem daria o 504 é o balanceador, e o próprio PHP para em max_execution_time.", label:'Timeout do servidor web (s)', min:5, max:120, step:5 },
  { k:'detect', tip:"Tempo até o balanceador notar que um backend caiu. Nesse intervalo ele ainda envia requisições ao backend morto (502). Aqui não há nova tentativa. O nginx, por padrão (proxy_next_upstream error timeout), refaz em outro backend quando a conexão é recusada e o cliente quase não vê erro; o HAProxy repete no mesmo servidor (retries) e só muda de servidor com option redispatch.", label:'Tempo até o balanceador notar backend caído (s)', min:0, max:10, step:1 },
  { k:'speed', label:'Velocidade da simulação', opts:[['0.1','0,1x'], ['0.25','0,25x'], ['0.5','0,5x'], ['1','1x'], ['2','2x'], ['4','4x']] },
];

export const GROUPS = [
  ['Servidor web e balanceador', ['arch', 'nb', 'lb', 'T']],
  ['PHP-FPM', ['pm', 'W', 'start', 'minSpare', 'maxSpare', 'idleTimeout']],
  ['Aplicação PHP', ['exec', 'opcache', 'session', 'redisMs']],
  ['Carga e clientes', ['rate', 'slowPct', 'slowMs']],
  ['Timeouts e falhas', ['timeout', 'detect']],
  ['Simulação', ['speed']],
];

// parâmetros que só fazem sentido em certas configurações ficam desabilitados
export const ENABLE = {
  pm: c => c.arch === 'B', W: c => c.arch === 'B',
  start: c => c.arch === 'B' && c.pm === 'dynamic', minSpare: c => c.arch === 'B' && c.pm === 'dynamic', maxSpare: c => c.arch === 'B' && c.pm === 'dynamic',
  idleTimeout: c => c.arch === 'B' && c.pm === 'ondemand',
  lb: c => c.nb > 1, slowMs: c => c.slowPct > 0, redisMs: c => c.session === 'redis',
};

// índice do valor mais próximo de v numa lista de valores permitidos
export const idxOf = (vals, v) => vals.reduce((bi, x, i) => Math.abs(x - v) < Math.abs(vals[bi] - v) ? i : bi, 0);
