import { APIRequestContext, expect, Page, test as base } from '@playwright/test';

/** Compte créé pour UN test : les tests ne se partagent aucune donnée. */
export interface Account {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly token: string;
}

/** Fichier prêt pour `setInputFiles` ou un upload multipart. */
export interface AudioFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

let counter = 0;

/** Adresse email unique (les tests tournent en parallèle sur la même base). */
export function uniqueEmail(prefix = 'e2e'): string {
  counter++;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@example.com`;
}

/** Crée un compte via l'API (plus rapide que par l'interface). */
export async function registerAccount(request: APIRequestContext, name = 'Testeur E2E'): Promise<Account> {
  const email = uniqueEmail();
  const password = 'MotDePasse123!';
  const response = await request.post('/api/auth/register', { data: { name, email, password } });
  expect(response.status(), await response.text()).toBe(201);
  const { token } = (await response.json()) as { token: string };
  return { name, email, password, token };
}

/** Ouvre une session dans le navigateur en déposant le token (comme après une connexion). */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('gpc_token', token), account.token);
}

/**
 * Génère un vrai fichier WAV (sinusoïde 440 Hz, 16 bits mono) : lisible
 * par tous les navigateurs, sans fichier binaire à versionner.
 */
export function wavFile(name = 'la-440.wav', seconds = 0.5, sampleRate = 8000): AudioFile {
  const samples = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // taille du bloc fmt
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), 44 + i * 2);
  }
  return { name, mimeType: 'audio/wav', buffer };
}

/** Ajoute une piste directement via l'API (préparation rapide des données). */
export async function uploadTrack(request: APIRequestContext, account: Account, title: string, file = wavFile()): Promise<void> {
  const response = await request.post('/api/tracks', {
    headers: { Authorization: `Bearer ${account.token}` },
    multipart: { title, audio: file },
  });
  expect(response.status(), await response.text()).toBe(201);
}

/**
 * `account` : un compte neuf par test.
 * `signedInPage` : une page déjà connectée avec ce compte.
 */
export const test = base.extend<{ account: Account; signedInPage: Page }>({
  account: async ({ request }, use) => {
    await use(await registerAccount(request));
  },
  signedInPage: async ({ page, account }, use) => {
    await signIn(page, account);
    await use(page);
  },
});

export { expect };
