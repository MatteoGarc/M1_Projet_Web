import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthResponse } from '../models/auth-response.model';
import { AuthService } from './auth.service';

/**
 * Tests unitaires de `AuthService`, sans backend ni MongoDB : les réponses
 * HTTP sont simulées par `HttpTestingController`.
 * Le token utilisé est une chaîne FICTIVE (pas un vrai JWT).
 */
describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  const response: AuthResponse = {
    token: 'fake-token-for-tests',
    user: { id: 'u1', name: 'Demo', email: 'demo@example.com', createdAt: '2026-10-05T10:00:00.000Z' },
  };

  beforeEach(() => {
    // Le Signal `token` est initialisé depuis localStorage à la création du
    // service : on part d'un état propre pour que les tests soient
    // reproductibles et indépendants les uns des autres.
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('login() envoie POST /api/auth/login avec { email, password } exactement', () => {
    service.login('demo@example.com', 'Demo1234!').subscribe();

    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'demo@example.com', password: 'Demo1234!' });

    req.flush(response);
  });

  it('login() réussi mémorise le token (Signal + localStorage) et l’utilisateur', () => {
    expect(service.isAuthenticated()).toBe(false);

    service.login('demo@example.com', 'Demo1234!').subscribe();
    http.expectOne('/api/auth/login').flush(response);

    expect(service.token()).toBe('fake-token-for-tests');
    expect(localStorage.getItem('gpc_token')).toBe('fake-token-for-tests');
    expect(service.currentUser()).toEqual(response.user);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('login() refusé (401) ne mémorise rien', () => {
    let status: number | undefined;
    service.login('demo@example.com', 'mauvais').subscribe({
      error: (e: { status: number }) => (status = e.status),
    });
    http
      .expectOne('/api/auth/login')
      .flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(service.token()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });

  it('logout() efface le token et l’utilisateur', () => {
    service.login('demo@example.com', 'Demo1234!').subscribe();
    http.expectOne('/api/auth/login').flush(response);

    service.logout();

    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });
});
