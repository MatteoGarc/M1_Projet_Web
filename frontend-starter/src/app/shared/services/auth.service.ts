import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

/** Handles authentication and the current user's profile. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /**
   * Utilisateur connecté (données publiques renvoyées par l'API).
   * C'est un Signal : tout template qui appelle `currentUser()` est
   * recalculé automatiquement quand la valeur change (profil réactif).
   * Il vit uniquement en mémoire : perdu au rechargement de la page tant
   * que `profile()` n'a pas été rappelé.
   */
  readonly currentUser = signal<User | null>(null);

  /**
   * JWT courant. Initialisé depuis `localStorage` pour survivre à un
   * rechargement de page. Ne jamais l'afficher ni le journaliser.
   */
  readonly token = signal<string | null>(localStorage.getItem('gpc_token'));

  /**
   * Valeur dérivée : vrai tant qu'un token est présent. Se recalcule tout
   * seul quand `token` change (`computed`). Indique seulement qu'un token
   * est *présent*, pas qu'il est encore valide : seul le backend peut le
   * vérifier, d'où `unauthorizedInterceptor` qui gère le cas 401.
   */
  readonly isAuthenticated = computed(() => this.token() !== null);

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  register(name: string, email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/register', { name, email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  profile() {
    return this.http
      .get<User>('/api/users/me')
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  update(name: string) {
    return this.http
      .put<User>('/api/users/me', { name })
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  logout(): void {
    localStorage.removeItem('gpc_token');
    this.token.set(null);
    this.currentUser.set(null);
  }

  private storeAuthentication(response: AuthResponse): void {
    localStorage.setItem('gpc_token', response.token);
    this.token.set(response.token);
    this.currentUser.set(response.user);
  }
}
