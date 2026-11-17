import { expect, test, uploadTrack } from './fixtures';

/**
 * Qualité transverse : erreurs JavaScript, affichage mobile, clavier.
 * Ces vérifications reprennent une partie des tests manuels.
 */
test.describe('Qualité', () => {
  test.describe('avec les animations (fond WebGL animé)', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('aucune erreur JavaScript ni erreur console sur les pages principales', async ({ signedInPage: page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`exception : ${error.message}`));
      page.on('console', (message) => {
        // Le navigateur demande /favicon.ico : le projet n'en fournit pas.
        if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) {
          errors.push(`console : ${message.text()} (${message.location().url})`);
        }
      });

      for (const url of ['/tracks', '/profile', '/record']) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
      }
      expect(errors).toEqual([]);
    });
  });

  for (const url of ['/login', '/register', '/tracks', '/record']) {
    test(`mobile 360 px : pas de défilement horizontal sur ${url}`, async ({ signedInPage: page, account, request }) => {
      await uploadTrack(request, account, 'Un titre de piste assez long pour tester le retour à la ligne sur mobile');
      await page.setViewportSize({ width: 360, height: 740 });
      if (url === '/login' || url === '/register') await page.evaluate(() => localStorage.clear());
      await page.goto(url);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'largeur de page qui dépasse l’écran (px)').toBeLessThanOrEqual(1);
    });
  }

  test('connexion entièrement au clavier', async ({ page, account }) => {
    await page.goto('/login');
    await page.getByLabel('Email').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(account.email);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Mot de passe')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(account.password);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tracks$/);
  });

  test('boîte de suppression : focus sur « Annuler », Échap ferme sans supprimer', async ({ signedInPage: page, account, request }) => {
    await uploadTrack(request, account, 'Piste clavier');
    await page.goto('/tracks');
    const remove = page.getByRole('button', { name: 'Supprimer Piste clavier' });
    await remove.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Le focus revient sur le bouton d'origine.
    await expect(remove).toBeFocused();
    await expect(page.getByRole('article', { name: 'Piste clavier' })).toBeVisible();
  });
});
