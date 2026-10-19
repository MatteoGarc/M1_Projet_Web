import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../services/auth.service';
import { authGuard } from './auth.guard';

/**
 * Test du guard fonctionnel `authGuard`.
 *
 * Un guard fonctionnel utilise `inject()` : il doit donc être exécuté dans
 * un contexte d'injection, d'où `TestBed.runInInjectionContext(...)`.
 *
 * Ce test vérifie le CONFORT de navigation, pas la sécurité : le guard ne
 * lit que la PRÉSENCE d'un token dans le navigateur. Un utilisateur peut
 * modifier localStorage ou appeler l'API directement ; seul le backend
 * vérifie réellement le JWT.
 */
describe('authGuard', () => {
  let auth: AuthService;
  let router: Router;

  // Le guard n'utilise pas ces deux arguments : des objets vides suffisent.
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/tracks' } as RouterStateSnapshot;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient()],
    });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  it('redirige vers /login un utilisateur sans token', () => {
    auth.token.set(null);

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('laisse passer un utilisateur qui a un token', () => {
    auth.token.set('fake-token-for-tests');

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));

    expect(result).toBe(true);
  });
});
