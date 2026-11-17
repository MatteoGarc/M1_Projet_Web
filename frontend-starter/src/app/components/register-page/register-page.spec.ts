import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from '../../shared/interceptors/auth.interceptor';
import { unauthorizedInterceptor } from '../../shared/interceptors/unauthorized.interceptor';
import { RegisterPageComponent } from './register-page';

/** Page d'inscription avec l'API simulée (`HttpTestingController`). */
describe('RegisterPageComponent (API simulée)', () => {
  let fixture: ComponentFixture<RegisterPageComponent>;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  function fill(name: string, email: string, password: string): void {
    const [nameInput, emailInput, passwordInput] = [...el().querySelectorAll('input')];
    for (const [control, value] of [
      [nameInput, name],
      [emailInput, email],
      [passwordInput, password],
    ] as const) {
      control.value = value;
      control.dispatchEvent(new Event('input'));
    }
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
      imports: [RegisterPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, unauthorizedInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RegisterPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('formulaire vide au départ', () => {
    expect([...el().querySelectorAll('input')].map((i) => i.value)).toEqual(['', '', '']);
  });

  it('succès (201) : POST /api/auth/register, token stocké puis redirection vers /profile', async () => {
    fill('Alice', 'alice@example.com', 'motdepasse');
    await submit();

    const req = http.expectOne('/api/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
    req.flush(
      { token: 'jwt-alice', user: { id: 'u2', name: 'Alice', email: 'alice@example.com', createdAt: '2026-11-17' } },
      { status: 201, statusText: 'Created' },
    );

    expect(localStorage.getItem('gpc_token')).toBe('jwt-alice');
    expect(navigate).toHaveBeenCalledWith('/profile');
  });

  it('409 (email déjà utilisé) : message du serveur affiché', async () => {
    fill('Alice', 'demo@example.com', 'motdepasse');
    await submit();
    http.expectOne('/api/auth/register').flush({ message: 'Email déjà utilisé' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(el().querySelector('.error')?.textContent).toBe('Email déjà utilisé');
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });

  it('400 (mot de passe trop court, vérifié par le backend) : message du serveur affiché', async () => {
    fill('Alice', 'alice@example.com', 'court');
    await submit();
    http
      .expectOne('/api/auth/register')
      .flush({ message: 'Nom, email et mot de passe de 8 caractères requis' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(el().querySelector('.error')?.textContent).toBe('Nom, email et mot de passe de 8 caractères requis');
  });

  it('erreur réseau : message générique', async () => {
    fill('Alice', 'alice@example.com', 'motdepasse');
    await submit();
    http.expectOne('/api/auth/register').error(new ProgressEvent('error'), { status: 0 });
    fixture.detectChanges();

    expect(el().querySelector('.error')?.textContent).toBe('Erreur d’inscription');
  });
});
