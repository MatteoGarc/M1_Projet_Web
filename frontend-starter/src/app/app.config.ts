import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './routes';
import { authInterceptor } from './shared/interceptors/auth.interceptor';
import { unauthorizedInterceptor } from './shared/interceptors/unauthorized.interceptor';

/**
 * Configuration globale de l'application (fournisseurs injectables).
 *
 * Elle est séparée de `main.ts` (TP3) pour pouvoir être TESTÉE :
 * `app.config.spec.ts` vérifie que `HttpClient` utilise bien le backend
 * XMLHttpRequest, indispensable à la progression de l'upload.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    // TP3 Mission 6 : depuis Angular 22, HttpClient utilise l'API `fetch`
    // par défaut. `fetch` ne sait PAS signaler la progression d'un ENVOI :
    // sans `withXhr()`, Angular refuserait la requête d'upload (NG02824).
    // `withXhr()` remet le backend XMLHttpRequest, dont
    // `xhr.upload.onprogress` fournit les événements `UploadProgress`.
    provideHttpClient(withXhr(), withInterceptors([authInterceptor, unauthorizedInterceptor])),
  ],
};
