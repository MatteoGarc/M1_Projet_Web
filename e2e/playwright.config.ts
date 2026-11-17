import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright.
 *
 * Ne pas lancer `npx playwright test` directement : utilisez
 * `node e2e/run-e2e.mjs`, qui prépare l'environnement jetable (MongoDB,
 * backend, build Angular, navigateurs) et fournit les variables E2E_*.
 */
const baseURL = process.env['E2E_BASE_URL'];
if (!baseURL) {
  throw new Error('E2E_BASE_URL absent : lancez les tests avec « node e2e/run-e2e.mjs » (voir e2e/README.md).');
}

const chromiumExecutable = process.env['E2E_CHROMIUM_EXECUTABLE'];

export default defineConfig({
  testDir: './tests',
  outputDir: process.env['E2E_OUTPUT_DIR'] ?? 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: process.env['E2E_REPORT_DIR'] ?? 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'fr-FR',
    // Animations réduites (comme le réglage d'accessibilité du système) : le
    // fond WebGL animé est figé et les animations Material sont coupées.
    // Sans cela, sur une machine sans carte graphique (CI, VM), le rendu
    // logiciel du fond peut bloquer la page (dialogues qui ne se ferment
    // plus, audio qui ne se charge pas). Le test « aucune erreur console »
    // de quality.spec.ts réactive les animations.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Faux micro (un bip) et autorisation automatique : aucun vrai
        // périphérique n'est utilisé, aucune fenêtre d'autorisation.
        permissions: ['microphone'],
        launchOptions: {
          ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
    {
      // Moteur de Safari. Il n'a pas de faux micro : les tests de
      // l'enregistreur y sont ignorés (voir recorder.spec.ts).
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
