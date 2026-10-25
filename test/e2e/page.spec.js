// A página no navegador: carrega sem erros, cenários e controles funcionam, layout em telas estreitas e temas.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PAGE = new URL('../../dist/simulador.html', import.meta.url).href;
const FIXTURE = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// falha o teste se a página emitir qualquer erro
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  await page.goto(PAGE);
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

const stat = async (page, label) => {
  const box = page.locator('#stats div', { hasText:label }).first();
  return (await box.locator('b').textContent()).trim();
};

test('carrega com o estado inicial e a simulação anda', async ({ page }) => {
  await expect(page.locator('#presets button')).toHaveCount(21);
  await expect(page.locator('#killers button')).toHaveText(['Derrubar app1']);
  await page.waitForTimeout(3000);
  expect(Number(await stat(page, 'concluídas'))).toBeGreaterThan(0);
});

test('cada cenário aplica a descrição e as ações sem erro', async ({ page }) => {
  const n = await page.locator('#presets button').count();
  for (let i = 0; i < n; i++) {
    const chip = page.locator('#presets button').nth(i);
    await chip.click();
    await expect(chip).toHaveClass(/on/);
    await expect(page.locator('#desc')).not.toHaveText(/Escolha um cenário/);
    const actions = page.locator('#desc button');
    for (let a = 0; a < await actions.count(); a++) await actions.nth(a).click();
  }
});

test('ação do cenário muda o parâmetro na interface', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Dependência lenta' }).click();
  await page.locator('#desc button', { hasText:'Banco ficou lento' }).click();
  await expect(page.locator('#v-exec')).toHaveText('2000');
});

test('derrubar e subir backend e Redis atualizam botões e erros', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Backend cai' }).click();
  await expect(page.locator('#killers button')).toHaveCount(3);
  await page.locator('#killers button').nth(1).click();
  await expect(page.locator('#killers button').nth(1)).toHaveText('Subir app2');
  await expect(page.locator('#stats')).toContainText('erro 502', { timeout:5000 });
  await page.click('#redisBtn');
  await expect(page.locator('#redisBtn')).toHaveText('Subir Redis');
});

test('padrão: sessão no Redis e MySQL ligados', async ({ page }) => {
  await expect(page.locator('select[data-k=session]')).toHaveValue('redis');
  await expect(page.locator('select[data-k=db]')).toHaveValue('mysql');
  await expect(page.locator('#sesscard')).toBeVisible();
  await expect(page.locator('#dbBtn')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('conexões MySQL');
  await page.waitForTimeout(3000);
  expect(await stat(page, 'erros')).toBe('0');
});

test('tabela de sessões só aparece com sessão', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Pool saturado' }).click();
  await expect(page.locator('#sesscard')).toBeHidden();
  await page.locator('#presets button', { hasText:'Sessões em 3 backends' }).click();
  await expect(page.locator('#sesscard')).toBeVisible();
  await expect(page.locator('#sess tr')).toHaveCount(6);
  await page.selectOption('select[data-k=session]', 'none');
  await expect(page.locator('#sesscard')).toBeHidden();
});

test('Redis fora: respostas 200 sem sessão, sem erros', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Sessão no Redis' }).click();
  await page.waitForTimeout(1500);
  await page.click('#redisBtn');
  await expect(page.locator('#stats')).toContainText('respostas 200 sem sessão', { timeout:6000 });
  expect(await stat(page, 'erros')).toBe('0');
  await expect(page.locator('#sess')).toContainText('sessão não lida');
});

test('MySQL: botões só com banco; queda dá 500 (2002) e o estado mostra as conexões', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Pool saturado' }).click();
  await expect(page.locator('#dbBtn')).toBeHidden();
  await expect(page.locator('[data-k=dbMaxConn]')).toBeDisabled();
  await page.locator('#presets button', { hasText:'MySQL fora do ar' }).click();
  await expect(page.locator('#dbBtn')).toBeVisible();
  await expect(page.locator('[data-k=dbMaxConn]')).toBeEnabled();
  await expect(page.locator('#stats')).toContainText('conexões MySQL');
  await page.click('#dbBtn');
  await expect(page.locator('#dbBtn')).toHaveText('Subir MySQL');
  await expect(page.locator('#stats')).toContainText('MySQL 2002', { timeout:6000 });
  await expect(page.locator('#stats')).toContainText('erro 500');
  // outro cenário religa o MySQL
  await page.locator('#presets button', { hasText:'Lock: 504' }).click();
  await expect(page.locator('#dbBtn')).toHaveText('Derrubar MySQL');
  await page.locator('#desc button', { hasText:'Travar a linha' }).click();
  await expect(page.locator('#lockBtn')).toHaveText('Destravar a linha');
  await expect(page.locator('#stats')).toContainText('esperando lock de linha', { timeout:6000 });
  await page.locator('#presets button', { hasText:'Pool saturado' }).click();
  await expect(page.locator('#dbBtn')).toBeHidden();
});

test('ação que muda parâmetro estrutural reinicia a simulação', async ({ page }) => {
  await page.locator('#presets button', { hasText:'Gargalo no MySQL' }).click();
  await page.waitForTimeout(2000);
  await page.locator('#desc button', { hasText:'max_children = 80' }).click();
  await expect(page.locator('#v-W')).toHaveText('80');
  await expect.poll(async () => Number(await stat(page, 'concluídas'))).toBeLessThan(20); // o painel atualiza a cada 250 ms
});

test('parâmetros se habilitam conforme a configuração', async ({ page }) => {
  const off = k => page.locator(`[data-k=${k}]`);
  await expect(off('lb')).toBeDisabled();
  await expect(off('start')).toBeDisabled();
  await page.selectOption('select[data-k=pm]', 'dynamic');
  await expect(off('start')).toBeEnabled();
  await expect(off('idleTimeout')).toBeDisabled();
  await page.selectOption('select[data-k=arch]', 'A');
  await expect(off('pm')).toBeDisabled();
  await expect(off('W')).toBeDisabled();
  await page.selectOption('select[data-k=nb]', '3');
  await expect(off('lb')).toBeEnabled();
  await expect(page.locator('#killers button')).toHaveCount(3);
});

test('balão de ajuda abre e fecha', async ({ page }) => {
  const prm = page.locator('.prm', { has:page.locator('[data-k=W]') });
  await prm.locator('.q').click();
  await expect(prm.locator('.tipbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(prm.locator('.tipbox')).toBeHidden();
});

test('carregar configuração aplica valores e mostra o relatório', async ({ page }) => {
  await page.setInputFiles('#cfgfile', [FIXTURE('lab03-www.conf'), FIXTURE('lab05-httpd-event.conf')]);
  await expect(page.locator('#cfgreport')).toContainText('pm = ondemand');
  await expect(page.locator('#cfgreport')).toContainText('Reconhecido, mas não simulado');
  await expect(page.locator('select[data-k=pm]')).toHaveValue('ondemand');
  await expect(page.locator('#v-T')).toHaveText('100');
});

test('carregar my.cnf liga o MySQL com max_connections e innodb_lock_wait_timeout', async ({ page }) => {
  await page.setInputFiles('#cfgfile', [FIXTURE('my.cnf')]);
  await expect(page.locator('#cfgreport')).toContainText('max_connections = 300');
  await expect(page.locator('select[data-k=db]')).toHaveValue('mysql');
  await expect(page.locator('#v-lockWait')).toHaveText('10');
});

test('canvas usa devicePixelRatio no tamanho do buffer', async ({ browser }) => {
  const page = await browser.newPage({ viewport:{ width:1040, height:900 }, deviceScaleFactor:2 });
  await page.goto(PAGE); await page.waitForTimeout(300);
  const [w, cw] = await page.locator('#cv').evaluate(c => [c.width, c.clientWidth]);
  expect(w).toBe(cw * 2);
  await page.close();
});

test('em 390 px não há rolagem horizontal', async ({ browser }) => {
  const page = await browser.newPage({ viewport:{ width:390, height:800 } });
  await page.goto(PAGE);
  await page.locator('#presets button', { hasText:'Sessões em 3 backends' }).click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.close();
});

test('tema escuro aplica as cores escuras', async ({ browser }) => {
  const page = await browser.newPage({ colorScheme:'dark' });
  await page.goto(PAGE);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(18, 21, 28)');
  await page.close();
});
