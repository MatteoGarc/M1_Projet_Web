import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog';
import { ConfirmDialogData } from '../models/confirm-dialog-data.model';
import { AuthService } from '../services/auth.service';

/** Page capable de dire si elle contient un travail non sauvegardé. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Demande confirmation avant de quitter une page dont le travail n'est pas
 * sauvegardé (ex. prises de l'enregistreur, qui ne vivent qu'en mémoire).
 *
 * Si la session est terminée (déconnexion, 401), on laisse partir : rester
 * sur une page privée sans token n'aurait aucun sens.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges() || !inject(AuthService).token()) {
    return true;
  }

  const data: ConfirmDialogData = {
    title: 'Quitter sans sauvegarder ?',
    message: 'Vos prises ne sont pas sauvegardées et seront perdues.',
    confirmLabel: 'Quitter',
    cancelLabel: 'Rester',
  };

  return inject(MatDialog)
    .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data, restoreFocus: true })
    .afterClosed()
    .pipe(map((confirmed) => confirmed === true));
};
