import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Réagit aux réponses `401 Unauthorized` renvoyées par l'API.
 *
 * Le JWT signé par le backend expire au bout de 2 heures
 * (`backend/src/app.js`, fonction `token()`). Passé ce délai, ou si le token
 * est absent/invalide, le middleware `auth` du backend répond `401`.
 *
 * Sujet Mission 1 : « gestion d'un 401, avec retour vers /login si le token
 * est invalide ou expiré ».
 *
 * Cas particulier : un 401 renvoyé par `/api/auth/login` signifie
 * « identifiants incorrects », pas « session expirée ». On ne doit donc pas
 * déclencher la déconnexion/redirection dans ce cas précis, sinon le message
 * d'erreur du formulaire de connexion ne pourrait jamais s'afficher.
 */
export const unauthorizedInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isAuthEndpoint = request.url.startsWith('/api/auth/');

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthEndpoint) {
        // On ne journalise jamais le token : uniquement l'URL concernée.
        console.warn(`[UnauthorizedInterceptor] 401 sur ${request.url} : session terminée`);
        auth.logout();
        void router.navigateByUrl('/login');
      }

      // On relance l'erreur : le composant appelant garde son propre
      // callback `error` pour afficher un message si besoin.
      return throwError(() => error);
    }),
  );
};
