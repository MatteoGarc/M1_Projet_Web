import { expect, registerAccount, signIn, test, uploadTrack, wavFile } from './fixtures';

/**
 * Bibliothèque de pistes à travers le vrai backend : import (avec
 * validation côté client), lecture authentifiée, suppression, pagination
 * et isolation entre comptes.
 */
test.describe('Bibliothèque de pistes', () => {
  // Le champ fichier est exposé comme un bouton (« Fichier audio … ») par les navigateurs.
  test('bibliothèque vide pour un nouveau compte', async ({ signedInPage: page }) => {
    await page.goto('/tracks');
    await expect(page.getByText('Aucune piste pour l’instant.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Mes pistes \(0\)/ })).toBeVisible();
  });

  test('importer un WAV : message de succès, carte affichée puis lecture', async ({ signedInPage: page }) => {
    await page.goto('/tracks');
    await page.getByRole('textbox', { name: /^Titre/ }).fill('Ma piste E2E');
    await page.getByRole('button', { name: /^Fichier audio/ }).setInputFiles(wavFile());
    await page.getByRole('button', { name: 'Envoyer' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'a bien été ajoutée' })).toContainText('« Ma piste E2E »');
    const card = page.getByRole('article', { name: 'Ma piste E2E' });
    await expect(card).toContainText('WAV');
    await expect(card).toContainText('la-440.wav');

    // Lecture : le fichier est téléchargé AVEC le token, puis confié au lecteur.
    const audioResponse = page.waitForResponse((r) => /\/api\/tracks\/[^/]+\/audio$/.test(r.url()));
    await card.getByRole('button', { name: 'Lire Ma piste E2E' }).click();
    expect((await audioResponse).status()).toBe(200);

    const player = page.getByRole('region', { name: 'Lecteur audio' });
    await expect(player).toContainText('Ma piste E2E');
    await expect(player.locator('audio')).toHaveAttribute('src', /^blob:/);
    // Le navigateur a réussi à décoder le fichier (métadonnées chargées).
    await expect.poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('fichier non audio : refusé immédiatement, aucune requête envoyée', async ({ signedInPage: page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/tracks')) posts.push(r.url());
    });
    await page.goto('/tracks');
    await page.getByRole('button', { name: /^Fichier audio/ }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('pas du son') });

    await expect(page.getByRole('alert')).toContainText('Format non accepté (text/plain)');
    await expect(page.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    expect(posts).toEqual([]);
  });

  test('fichier de plus de 25 Mo : refusé avant l’envoi', async ({ signedInPage: page }) => {
    await page.goto('/tracks');
    await page
      .getByRole('button', { name: /^Fichier audio/ })
      .setInputFiles({ name: 'enorme.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) });

    await expect(page.getByRole('alert')).toContainText('la limite est de 25 Mo');
    await expect(page.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  });

  test('suppression : annulation puis confirmation', async ({ signedInPage: page, account, request }) => {
    await uploadTrack(request, account, 'Piste à supprimer');
    await page.goto('/tracks');
    const card = page.getByRole('article', { name: 'Piste à supprimer' });

    await card.getByRole('button', { name: 'Supprimer Piste à supprimer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Supprimer cette piste ?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Supprimer Piste à supprimer' }).click();
    await dialog.getByRole('button', { name: 'Supprimer' }).click();

    await expect(page.getByText('« Piste à supprimer » a été supprimée.')).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Aucune piste pour l’instant.')).toBeVisible();
  });

  test('pagination serveur : 6 pistes → 2 pages', async ({ signedInPage: page, account, request }) => {
    for (let i = 1; i <= 6; i++) await uploadTrack(request, account, `Piste ${i}`);
    await page.goto('/tracks');

    await expect(page.getByRole('heading', { name: /Mes pistes \(6\)/ })).toBeVisible();
    await expect(page.getByText('Page 1 / 2')).toBeVisible();
    await expect(page.locator('app-track-card')).toHaveCount(5);
    // Tri du plus récent au plus ancien.
    await expect(page.locator('app-track-card h3').first()).toHaveText('Piste 6');

    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByText('Page 2 / 2')).toBeVisible();
    await expect(page.locator('app-track-card')).toHaveCount(1);
    await expect(page.locator('app-track-card h3')).toHaveText('Piste 1');
    await expect(page.getByRole('button', { name: 'Suivant' })).toBeDisabled();
  });

  test('un compte ne voit jamais les pistes d’un autre compte', async ({ page, account, request }) => {
    await uploadTrack(request, account, 'Piste privée de A');
    const other = await registerAccount(request, 'Compte B');

    await signIn(page, other);
    await page.goto('/tracks');
    await expect(page.getByText('Aucune piste pour l’instant.')).toBeVisible();
    await expect(page.getByText('Piste privée de A')).toHaveCount(0);
  });
});
