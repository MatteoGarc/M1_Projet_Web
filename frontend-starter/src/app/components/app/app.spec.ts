import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../shared/services/auth.service';
import { AppComponent } from './app';

/** En-tête de l'application : liens selon la connexion, et déconnexion. */
describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let auth: AuthService;

  const links = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map((a) => a.textContent?.trim());

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
    auth = TestBed.inject(AuthService);
    fixture = TestBed.createComponent(AppComponent);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('visiteur : liens de connexion et d’inscription seulement', () => {
    fixture.detectChanges();
    expect(links()).toEqual(['Connexion', 'Créer un compte']);
  });

  it('connecté : liens privés, nom de l’utilisateur et bouton de déconnexion', () => {
    auth.token.set('fake-token-for-tests');
    auth.currentUser.set({ id: 'u1', name: 'Alice', email: 'alice@example.com', createdAt: '2026-01-01' });
    fixture.detectChanges();

    expect(links()).toEqual(['Backing tracks', 'Profil']);
    expect((fixture.nativeElement as HTMLElement).querySelector('nav span')?.textContent).toBe('Alice');
  });

  it('déconnexion : efface le token stocké et renvoie vers /login', () => {
    localStorage.setItem('gpc_token', 'fake-token-for-tests');
    auth.token.set('fake-token-for-tests');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('nav button')?.click();
    fixture.detectChanges();

    expect(localStorage.getItem('gpc_token')).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(links()).toEqual(['Connexion', 'Créer un compte']);
  });
});
