import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from '../../shared/interceptors/auth.interceptor';
import { unauthorizedInterceptor } from '../../shared/interceptors/unauthorized.interceptor';
import { User } from '../../shared/models/user.model';
import { AuthService } from '../../shared/services/auth.service';
import { ProfilePageComponent } from './profile-page';

/** Page profil avec l'API simulée : lecture puis modification du nom. */
describe('ProfilePageComponent (API simulée)', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;
  let http: HttpTestingController;
  let auth: AuthService;

  const user: User = { id: 'u1', name: 'Demo', email: 'demo@example.com', createdAt: '2026-03-14T09:26:53.000Z' };
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  async function load(): Promise<void> {
    button('Charger mon profil').click();
    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-test');
    req.flush(user);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, unauthorizedInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.token.set('jwt-de-test');
    fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('n’appelle pas l’API avant le clic et n’affiche pas de formulaire', () => {
    http.expectNone('/api/users/me');
    expect(el().querySelector('form')).toBeNull();
  });

  it('chargement : affiche nom, email, date d’inscription et pré-remplit le formulaire', async () => {
    await load();

    expect(el().querySelector('b')?.textContent).toBe('Demo');
    expect(el().textContent).toContain('demo@example.com');
    expect(el().textContent).toContain('Membre depuis 2026-03-14');
    expect(el().querySelector<HTMLInputElement>('form input')?.value).toBe('Demo');
  });

  it('enregistrement : PUT /api/users/me avec le nouveau nom, affichage mis à jour', async () => {
    await load();
    const nameInput = el().querySelector<HTMLInputElement>('form input') as HTMLInputElement;
    nameInput.value = 'Demo Guitare';
    nameInput.dispatchEvent(new Event('input'));
    button('Enregistrer').click();

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Demo Guitare' });
    req.flush({ ...user, name: 'Demo Guitare' });
    fixture.detectChanges();

    expect(el().querySelector('b')?.textContent).toBe('Demo Guitare');
    expect(auth.currentUser()?.name).toBe('Demo Guitare');
  });

  it('erreur de chargement : rien n’est affiché et l’erreur est journalisée', async () => {
    button('Charger mon profil').click();
    http.expectOne('/api/users/me').flush({ message: 'Utilisateur inconnu' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(el().querySelector('form')).toBeNull();
    expect(console.error).toHaveBeenCalledWith('[ProfilePage] Chargement impossible', expect.anything());
  });

  it('erreur à l’enregistrement : l’ancien nom reste affiché', async () => {
    await load();
    button('Enregistrer').click();
    http.expectOne('/api/users/me').flush({ message: 'Erreur' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(el().querySelector('b')?.textContent).toBe('Demo');
    expect(console.error).toHaveBeenCalledWith('[ProfilePage] Enregistrement impossible', expect.anything());
  });

  it('401 (token expiré) : session fermée et retour vers /login', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button('Charger mon profil').click();
    http.expectOne('/api/users/me').flush({ message: 'Jeton invalide ou expiré' }, { status: 401, statusText: 'Unauthorized' });

    expect(auth.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
