import { HttpErrorResponse } from '@angular/common/http';

/**
 * Transforme une erreur HTTP en message compréhensible pour l'utilisateur.
 *
 * Le backend répond ses erreurs sous la forme `{ "message": "..." }`.
 * Cas particulier : pour une requête faite avec `responseType: 'blob'`
 * (lecture audio), Angular place aussi le corps d'ERREUR dans un `Blob` :
 * il faut donc le lire (`blob.text()`) puis le parser en JSON pour retrouver
 * `message`. C'est pour cela que la fonction est asynchrone.
 */
export async function httpErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (error.status === 0) {
    return 'Serveur injoignable : vérifiez que le backend est démarré.';
  }

  let body: unknown = error.error;

  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text());
    } catch (parseError) {
      console.warn('[httpErrorMessage] Corps d’erreur non JSON', parseError);
      body = null;
    }
  }

  const serverMessage =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message)
      : null;

  return serverMessage ? `${serverMessage} (HTTP ${error.status})` : `${fallback} (HTTP ${error.status})`;
}
