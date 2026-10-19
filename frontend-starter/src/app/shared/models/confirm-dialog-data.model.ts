/**
 * Données transmises à `ConfirmDialogComponent` via `MatDialog.open(..., { data })`.
 * Le dialogue est générique : le texte dépend de l'action à confirmer.
 */
export interface ConfirmDialogData {
  /** Titre court de la boîte de dialogue. */
  title: string;
  /** Explication de la conséquence de l'action. */
  message: string;
  /** Libellé du bouton de confirmation (ex. « Supprimer »). */
  confirmLabel: string;
  /** Libellé du bouton d'annulation (par défaut « Annuler »). */
  cancelLabel?: string;
}
