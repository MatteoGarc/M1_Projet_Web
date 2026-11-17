import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from '../../shared/interceptors/auth.interceptor';
import { unauthorizedInterceptor } from '../../shared/interceptors/unauthorized.interceptor';
import { AuthResponse } from '../../shared/models/auth-response.model';
import { AuthService } from '../../shared/services/auth.service';
import { LoginPageComponent } from './login-page';

/**
 * Page de connexion avec l'API SIMULÉE : le vrai `AuthService` et les vrais
 * intercepteurs sont utilisés, seul le réseau est remplacé par
 * `HttpTestingController`. On vérifie l'URL, le corps envoyé, puis la
 * réaction de la page à chaque réponse possible du backend.
 */
describe('LoginPageComponent (API simulée)', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (type: string) => el().querySelector<HTMLInputElement>(`input[type="${type}"]`) as HTMLInputElement;
  const response: AuthResponse = {
    token: 'jwt-de-test',
    user: { id: 'u1', name: 'Demo', email: 'demo@example.com', createdAt: '2026-01-01T00:00:00.000Z' },
  };

  function type(control: HTMLInputElement, value: string): void {
    control.value = value;
    control.dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();
  }

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, unauthorizedInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('pré-remplit le compte de démonstration', () => {
    expect(input('email').value).toBe('demo@example.com');
    expect(input('password').value).toBe('Demo1234!');
  });

  it('succès : POST /api/auth/login, token stocké puis redirection vers /tracks', async () => {
    type(input('email'), 'alice@example.com');
    type(input('password'), 'motdepasse');
    await submit();

    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'alice@example.com', password: 'motdepasse' });
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(response);

    expect(localStorage.getItem('gpc_token')).toBe('jwt-de-test');
    expect(TestBed.inject(AuthService).currentUser()).toEqual(response.user);
    expect(navigate).toHaveBeenCalledWith('/tracks');
  });

  it('401 (mauvais mot de passe) : affiche le message du serveur, reste sur la page, ne déconnecte rien', async () => {
    await submit();
    http
      .expectOne('/api/auth/login')
      .flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(el().querySelector('.error')?.textContent).toBe('Identifiants incorrects');
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });

  it('erreur sans message (serveur injoignable) : message générique', async () => {
    await submit();
    http.expectOne('/api/auth/login').error(new ProgressEvent('error'), { status: 0 });
    fixture.detectChanges();

    expect(el().querySelector('.error')?.textContent).toBe('Erreur de connexion');
  });

  it('une nouvelle erreur remplace l’ancienne', async () => {
    await submit();
    http.expectOne('/api/auth/login').flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });
    await submit();
    http.expectOne('/api/auth/login').flush({ message: 'Trop de tentatives' }, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();

    expect(el().querySelectorAll('.error')).toHaveLength(1);
    expect(el().querySelector('.error')?.textContent).toBe('Trop de tentatives');
  });

  it('propose un lien vers l’inscription', () => {
    expect(el().querySelector('a')?.getAttribute('href')).toBe('/register');
  });
});
