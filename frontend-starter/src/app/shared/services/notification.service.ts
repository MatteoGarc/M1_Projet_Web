import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * TP3 Mission 5 — messages courts de succès ou d'erreur (SnackBar
 * d'Angular Material, exigé par le sujet).
 *
 * Pourquoi un service plutôt qu'appeler `MatSnackBar` dans chaque page ?
 * - un seul endroit pour la durée, le style et l'accessibilité ;
 * - dans les tests, on remplace CE service par un faux (`vi.fn()`) et on
 *   vérifie simplement « success a été appelé avec tel message », sans
 *   dépendre du rendu de Material.
 *
 * Accessibilité : `MatSnackBar` annonce le message aux lecteurs d'écran
 * (via le `LiveAnnouncer` du CDK). `politeness: 'assertive'` pour une
 * erreur : elle interrompt la lecture en cours ; `polite` pour un succès.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'OK', {
      duration: 4000,
      politeness: 'polite',
      panelClass: 'snack--success',
    });
  }

  /** Les erreurs restent plus longtemps : l'utilisateur doit pouvoir les lire. */
  error(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 8000,
      politeness: 'assertive',
      panelClass: 'snack--error',
    });
  }
}
