import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { ConfirmDialogData } from '../../shared/models/confirm-dialog-data.model';

/**
 * TP3 Mission 5 — boîte de dialogue de confirmation (Angular Material).
 *
 * Elle est ouverte par `MatDialog.open(ConfirmDialogComponent, { data })`
 * et se ferme avec une valeur :
 * - `true`  si l'utilisateur confirme (bouton « Supprimer ») ;
 * - `false` s'il annule (bouton « Annuler ») ;
 * - `undefined` s'il ferme avec Échap ou un clic à l'extérieur.
 * L'appelant lit cette valeur avec `dialogRef.afterClosed()` et ne supprime
 * QUE si elle vaut `true`.
 *
 * Accessibilité fournie par `MatDialog` : rôle `dialog`, piège du focus
 * dans la boîte, retour du focus sur le bouton d'origine à la fermeture,
 * Échap pour fermer. `cdkFocusInitial` place le focus sur « Annuler » :
 * pour une action destructive, un appui involontaire sur Entrée ne doit
 * pas supprimer.
 *
 * Composant de présentation pur : aucun appel HTTP.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
