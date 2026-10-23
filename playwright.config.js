// Testes da página gerada (dist/simulador.html), abertos por file://. Rode com: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:'test/e2e',
  fullyParallel:true,
  reporter:[['list']],
  use:{ ...devices['Desktop Chrome'], viewport:{ width:1040, height:900 } },
});
