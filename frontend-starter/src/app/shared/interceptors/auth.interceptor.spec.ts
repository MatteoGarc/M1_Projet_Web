import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';
import { unauthorizedInterceptor } from './unauthorized.interceptor';

/**
 * Tests des deux intercepteurs, branchés EXACTEMENT comme dans `main.ts`
 * (`withInterceptors([authInterceptor, unauthorizedInterceptor])`).
 *
 * Ce qu'on vérifie : l'en-tête de la requête qui SORT de la chaîne
 * d'intercepteurs (capturée par `HttpTestingController`), et la réaction à
 * une réponse 401 simulée. Aucun serveur n'est contacté.
 */
describe('Intercepteurs HTTP', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, unauthorizedInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    controller.verify();
    localStorage.clear();
  });

  describe('authInterceptor', () => {
    it('ajoute Authorization: Bearer <token> lorsqu’un token existe', () => {
      auth.token.set('fake-token-for-tests');

      http.get('/api/users/me').subscribe();

      const req = controller.expectOne('/api/users/me');
      expect(req.request.headers.get('Authorization')).toBe('Bearer fake-token-for-tests');
      req.flush({});
    });

    it('n’ajoute aucun en-tête Authorization sans token', () => {
      auth.token.set(null);

      http.post('/api/auth/login', {}).subscribe();

      const req = controller.expectOne('/api/auth/login');
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    });

    it('ajoute aussi le token sur la requête DELETE de suppression', () => {
      auth.token.set('fake-token-for-tests');

      http.delete('/api/tracks/abc').subscribe();

      const req = controller.expectOne('/api/tracks/abc');
      expect(req.request.method).toBe('DELETE');
      expect(req.request.headers.get('Authorization')).toBe('Bearer fake-token-for-tests');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('unauthorizedInterceptor', () => {
    it('sur un 401 d’une route protégée : déconnecte et redirige vers /login', () => {
      auth.token.set('expired-token');
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      let status: number | undefined;

      http.delete('/api/tracks/abc').subscribe({ error: (e: { status: number }) => (status = e.status) });
      controller
        .expectOne('/api/tracks/abc')
        .flush({ message: 'Jeton invalide ou expiré' }, { status: 401, statusText: 'Unauthorized' });

      expect(auth.token()).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/login');
      // L'erreur est relancée : le composant peut encore afficher un message.
      expect(status).toBe(401);
    });

    it('sur un 401 de /api/auth/login (mauvais mot de passe) : ne déconnecte pas', () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const logout = vi.spyOn(auth, 'logout');

      http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
      controller
        .expectOne('/api/auth/login')
        .flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });

      expect(logout).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('ne réagit pas aux autres erreurs (404)', () => {
      auth.token.set('valid-token');
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      http.delete('/api/tracks/zzz').subscribe({ error: () => undefined });
      controller
        .expectOne('/api/tracks/zzz')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

      expect(auth.token()).toBe('valid-token');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
