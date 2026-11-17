import { expect, signIn, test, uniqueEmail } from './fixtures';

/**
 * Parcours d'authentification complet, à travers le VRAI backend
 * (Express + MongoDB) : inscription, profil, déconnexion, connexion,
 * erreurs et session expirée.
 */
test.describe('Authentification', () => {
  for (const privatePage of ['/tracks', '/profile', '/record']) {
    test(`sans session, ${privatePage} renvoie vers /login`, async ({ page }) => {
      await page.goto(privatePage);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    });
  }

  test('inscription → profil → déconnexion → connexion', async ({ page }) => {
    const email = uniqueEmail('inscription');
    const password = 'MotDePasse123!';

    await page.goto('/register');
    await page.getByLabel('Nom').fill('Alice Guitare');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();

    await expect(page).toHaveURL(/\/profile$/);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await expect(nav.getByText('Alice Guitare')).toBeVisible();

    await page.getByRole('button', { name: 'Charger mon profil' }).click();
    await expect(page.getByText(email)).toBeVisible();

    await nav.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(nav.getByRole('link', { name: 'Connexion' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('gpc_token'))).toBeNull();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/tracks$/);
    await expect(page.getByRole('heading', { name: 'Backing tracks', level: 1 })).toBeVisible();
  });

  test('le compte de démonstration fonctionne (identifiants pré-remplis)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/tracks$/);
  });

  test('mauvais mot de passe : message du serveur, on reste sur /login', async ({ page, account }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.locator('.error')).toHaveText('Identifiants incorrects');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('email déjà utilisé : message du serveur', async ({ page, account }) => {
    await page.goto('/register');
    await page.getByLabel('Nom').fill('Doublon');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Mot de passe').fill('MotDePasse123!');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();

    await expect(page.locator('.error')).toHaveText('Email déjà utilisé');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('token invalide ou expiré : la session est fermée et on revient à /login', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gpc_token', 'jeton.invalide.ou-expire'));

    await page.goto('/tracks');

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('gpc_token'))).toBeNull();
  });

  test('modifier son nom : la modification est enregistrée côté serveur', async ({ page, account }) => {
    await signIn(page, account);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Charger mon profil' }).click();
    await page.getByLabel('Nouveau nom').fill('Nom modifié E2E');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('section b')).toHaveText('Nom modifié E2E');

    // Rechargement complet : la valeur vient bien du serveur.
    await page.reload();
    await page.getByRole('button', { name: 'Charger mon profil' }).click();
    await expect(page.locator('section b')).toHaveText('Nom modifié E2E');
  });
});
