import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpErrorMessage } from './http-error-message';

/**
 * `httpErrorMessage` traduit une erreur HTTP en phrase lisible. Les cas
 * testés correspondent aux réponses réelles du backend (`{ message }`),
 * y compris pour une requête `responseType: 'blob'` (lecture audio) où le
 * corps d'erreur arrive lui aussi sous forme de `Blob`.
 */
describe('httpErrorMessage', () => {
  afterEach(() => vi.restoreAllMocks());

  const httpError = (status: number, error: unknown): HttpErrorResponse =>
    new HttpErrorResponse({ status, statusText: 'Erreur', error, url: '/api/tracks' });

  /**
   * Le `Blob` de jsdom n'implémente pas `text()` (les navigateurs, si) :
   * on l'ajoute pour reproduire le comportement réel.
   */
  const blobOf = (content: string, type: string): Blob =>
    Object.assign(new Blob([content], { type }), { text: () => Promise.resolve(content) });

  it('renvoie le message de secours pour une erreur qui n’est pas HTTP', async () => {
    expect(await httpErrorMessage(new Error('boom'), 'Secours')).toBe('Secours');
    expect(await httpErrorMessage('texte', 'Secours')).toBe('Secours');
  });

  it('statut 0 : serveur injoignable (backend arrêté, réseau coupé)', async () => {
    expect(await httpErrorMessage(httpError(0, new ProgressEvent('error')), 'Secours')).toBe(
      'Serveur injoignable : vérifiez que le backend est démarré.',
    );
  });

  it('utilise le message JSON du serveur et ajoute le statut', async () => {
    expect(await httpErrorMessage(httpError(409, { message: 'Email déjà utilisé' }), 'Secours')).toBe(
      'Email déjà utilisé (HTTP 409)',
    );
  });

  it('lit le message JSON contenu dans un Blob (requête audio)', async () => {
    const blob = blobOf(JSON.stringify({ message: 'Piste inconnue' }), 'application/json');
    expect(await httpErrorMessage(httpError(404, blob), 'Secours')).toBe('Piste inconnue (HTTP 404)');
  });

  it('Blob qui n’est pas du JSON : message de secours, sans planter', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blob = blobOf('<html>Bad Gateway</html>', 'text/html');

    expect(await httpErrorMessage(httpError(502, blob), 'Lecture impossible')).toBe('Lecture impossible (HTTP 502)');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('corps sans champ message (texte, null, objet) : message de secours avec le statut', async () => {
    expect(await httpErrorMessage(httpError(500, 'Internal Server Error'), 'Envoi impossible')).toBe(
      'Envoi impossible (HTTP 500)',
    );
    expect(await httpErrorMessage(httpError(500, null), 'Envoi impossible')).toBe('Envoi impossible (HTTP 500)');
    expect(await httpErrorMessage(httpError(500, { error: 'x' }), 'Envoi impossible')).toBe(
      'Envoi impossible (HTTP 500)',
    );
  });

  it('message vide : message de secours', async () => {
    expect(await httpErrorMessage(httpError(400, { message: '' }), 'Secours')).toBe('Secours (HTTP 400)');
  });
});
