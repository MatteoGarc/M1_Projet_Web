import { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Enregistreur, avec un FAUX micro fourni par le navigateur (voir
 * `playwright.config.ts`) : aucun vrai périphérique n'est utilisé.
 *
 * WebKit (Safari) n'a pas de faux micro pilotable : ces tests y sont
 * ignorés. L'enregistreur doit donc être vérifié à la main sur Safari.
 */
test.describe('Enregistreur', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'WebKit n’a pas de faux micro : à tester manuellement sur Safari.');

  async function recordTake(page: Page, seconds = 1.5): Promise<void> {
    await page.getByRole('button', { name: 'Autoriser le micro' }).click();
    await expect(page.getByRole('meter')).toBeVisible();

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Enregistrement…')).toBeVisible();
    // Durée réelle d'enregistrement voulue (pas une attente « au hasard »).
    await page.waitForTimeout(seconds * 1000);
    await page.getByRole('button', { name: 'Arrêter' }).click();

    await expect(page.getByRole('textbox', { name: 'Nom de la prise' })).toHaveValue('Prise 1');
  }

  test('enregistrer une prise puis la sauvegarder en MP3 dans la bibliothèque', async ({ signedInPage: page }) => {
    await page.goto('/tracks');
    await page.getByRole('link', { name: /Ouvrir l’enregistreur/ }).click();
    await expect(page).toHaveURL(/\/record$/);

    await recordTake(page);
    await expect(page.getByRole('heading', { name: /Prises \(1\)/ })).toBeVisible();

    await page.getByRole('textbox', { name: /^Titre/ }).fill('Enregistrement E2E');
    const upload = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/tracks'));
    await page.getByRole('button', { name: 'Sauvegarder dans ma bibliothèque' }).click();
    expect((await upload).status()).toBe(201);

    await expect(page).toHaveURL(/\/tracks$/);
    const card = page.getByRole('article', { name: 'Enregistrement E2E' });
    // Le backend a reçu un vrai MP3 (type audio/mpeg affiché « MP3 »).
    await expect(card).toContainText('MP3');
    await expect(card).toContainText('Enregistrement-E2E.mp3');
  });

  test('quitter avec des prises non sauvegardées demande confirmation', async ({ signedInPage: page }) => {
    await page.goto('/record');
    await recordTake(page, 0.8);

    const back = page.getByRole('link', { name: /Retour à la bibliothèque/ });
    await back.click();
    const dialog = page.getByRole('dialog', { name: 'Quitter sans sauvegarder ?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(/\/record$/);
    await expect(page.getByRole('textbox', { name: 'Nom de la prise' })).toHaveValue('Prise 1');

    await back.click();
    await dialog.getByRole('button', { name: 'Quitter' }).click();
    await expect(page).toHaveURL(/\/tracks$/);
  });
});
