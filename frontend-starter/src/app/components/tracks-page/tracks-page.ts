import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBar } from '@angular/material/progress-bar';
import { Subscription, finalize } from 'rxjs';
import { ConfirmDialogData } from '../../shared/models/confirm-dialog-data.model';
import { Track } from '../../shared/models/track.model';
import { UPLOAD_IDLE, UploadState } from '../../shared/models/upload-state.model';
import { FileSizePipe } from '../../shared/pipes/file-size.pipe';
import { NotificationService } from '../../shared/services/notification.service';
import { TRACKS_PAGE_SIZE, TrackService } from '../../shared/services/track.service';
import { httpErrorMessage } from '../../shared/utils/http-error-message';
import { uploadStateFromEvent } from '../../shared/utils/upload-state';
import { AUDIO_ACCEPT, validateAudioFile } from '../../shared/validators/audio-file.validator';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { TrackCardComponent } from '../track-card/track-card';

/**
 * Page « Backing tracks » : bibliothèque paginée côté serveur (Mission 2),
 * upload et lecture audio authentifiée (Mission 3), suppression d'une piste
 * (TP3 Mission 5) et progression de l'upload (TP3 Mission 6).
 *
 * Ce composant n'appelle JAMAIS `HttpClient` : toutes les requêtes passent
 * par `TrackService`.
 */
@Component({
  imports: [ReactiveFormsModule, MatProgressBar, FileSizePipe, TrackCardComponent],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  // ---------------------------------------------------------------------
  // Mission 2 — état de la bibliothèque paginée (Signals)
  // ---------------------------------------------------------------------
  readonly limit = TRACKS_PAGE_SIZE;
  /** Pistes de la page courante UNIQUEMENT (jamais toute la collection). */
  readonly tracks = signal<Track[]>([]);
  /** Page courante (1-indexée, comme le backend). */
  readonly page = signal(1);
  /** Nombre total de pages renvoyé par le serveur (`pages`). */
  readonly pages = signal(1);
  /** Nombre total de pistes renvoyé par le serveur (`total`). */
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasPrevious = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() < this.pages());

  /** Requête de liste en cours : annulée si une nouvelle page est demandée. */
  private listRequest?: Subscription;

  // ---------------------------------------------------------------------
  // Mission 3 — upload
  // ---------------------------------------------------------------------
  readonly accept = AUDIO_ACCEPT;
  readonly title = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] });
  /**
   * Le `FormGroup` lié par `[formGroup]` est indispensable : c'est la
   * directive `FormGroupDirective` qui capte `(ngSubmit)` et empêche la
   * soumission HTML native (sinon le navigateur recharge la page).
   */
  readonly uploadForm = new FormGroup({ title: this.title });
  readonly selectedFile = signal<File | null>(null);
  /** Erreur de validation du fichier (détectée côté client, avant HTTP). */
  readonly fileError = signal<string | null>(null);

  /**
   * TP3 Mission 6 — UN SEUL Signal décrit l'upload : `idle`, `uploading`
   * (avec pourcentage), `success` ou `error` (voir `UploadState`).
   * Remplace les anciens Signals `uploading`, `uploadError` et
   * `uploadSuccess` du TP2 : avec trois booléens/chaînes séparés, on pouvait
   * se retrouver dans un état incohérent (ex. succès ET erreur affichés).
   */
  readonly uploadState = signal<UploadState>(UPLOAD_IDLE);
  readonly uploading = computed(() => this.uploadState().status === 'uploading');
  /** Pourcentage courant, ou `null` (indéterminé / pas d'upload en cours). */
  readonly uploadProgress = computed(() => {
    const state = this.uploadState();
    return state.status === 'uploading' ? state.progress : null;
  });
  readonly canUpload = computed(
    () => this.selectedFile() !== null && !this.uploading() && this.fileError() === null,
  );
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private uploadRequest?: Subscription;

  // ---------------------------------------------------------------------
  // TP3 Mission 5 — suppression
  // ---------------------------------------------------------------------
  /**
   * Identifiants des pistes dont la requête `DELETE` est en cours.
   * Un `Set` (et non un simple booléen) : on peut supprimer la piste A puis
   * la piste B sans attendre, mais jamais deux fois la même piste.
   * On remplace le Set à chaque changement (immutabilité) pour que le
   * Signal détecte la modification.
   */
  readonly deletingIds = signal<ReadonlySet<string>>(new Set());

  // ---------------------------------------------------------------------
  // Mission 3 — lecture audio
  // ---------------------------------------------------------------------
  /** `blob:` URL affectée au lecteur `<audio>`. */
  readonly audioUrl = signal<string | null>(null);
  readonly currentTrack = signal<Track | null>(null);
  readonly loadingTrackId = signal<string | null>(null);
  readonly audioError = signal<string | null>(null);
  private audioRequest?: Subscription;

  constructor() {
    // À la destruction du composant (changement de route, déconnexion) :
    // on annule les requêtes en cours et on révoque l'ObjectURL FINALE,
    // sinon le Blob resterait en mémoire jusqu'à la fermeture de l'onglet.
    inject(DestroyRef).onDestroy(() => {
      this.listRequest?.unsubscribe();
      this.audioRequest?.unsubscribe();
      // Annuler l'abonnement à un upload en cours interrompt la requête
      // XMLHttpRequest (abort) : rien ne continue en arrière-plan.
      this.uploadRequest?.unsubscribe();
      this.revokeAudioUrl();
      console.debug('[TracksPage] Destruction : ObjectURL révoquée, requêtes annulées');
    });

    this.load();
  }

  // ======================= Mission 2 : pagination =======================

  /** Charge la page courante depuis le serveur : une requête HTTP par page. */
  load(): void {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    const requestedPage = this.page();
    this.listRequest = this.service
      .list(requestedPage, this.limit)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => {
          console.debug(
            `[TracksPage] Page ${response.page}/${response.pages} reçue : ${response.items.length} piste(s) sur ${response.total}`,
          );
          this.pages.set(response.pages);
          this.total.set(response.total);

          // Cas limite : la page demandée n'existe plus (ex. pistes
          // supprimées ailleurs). On redemande la dernière page existante.
          if (response.items.length === 0 && requestedPage > response.pages) {
            this.page.set(response.pages);
            this.load();
            return;
          }

          this.page.set(response.page);
          this.tracks.set(response.items);
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Chargement impossible', error);
          this.tracks.set([]);
          void httpErrorMessage(error, 'Impossible de charger vos pistes').then((message) =>
            this.error.set(message),
          );
        },
      });
  }

  /** Change de page puis refait une requête HTTP (aucun découpage local). */
  go(target: number): void {
    if (this.loading() || target < 1 || target > this.pages() || target === this.page()) {
      return;
    }
    console.debug(`[TracksPage] Changement de page ${this.page()} → ${target}`);
    this.page.set(target);
    this.load();
  }

  // ========================= Mission 3 : upload ==========================

  /** Choix du fichier : validation immédiate pour un retour instantané. */
  choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.selectedFile.set(file);
    // Un nouveau choix efface le message de l'envoi précédent.
    this.uploadState.set(UPLOAD_IDLE);
    this.fileError.set(file ? validateAudioFile(file) : null);
    console.debug('[TracksPage] Fichier sélectionné', file?.name, file?.type, file?.size);
  }

  /**
   * TP3 Mission 6 — envoi avec progression.
   *
   * Différence avec une requête « classique » (ex. `list()`) : l'Observable
   * n'émet pas UNE réponse mais une SUITE d'événements. `next` est donc
   * appelé plusieurs fois (0 %, 12 %, 47 %… puis la réponse) et c'est
   * `uploadStateFromEvent` qui traduit chaque événement en état affichable.
   */
  upload(): void {
    // Empêche les doubles soumissions (double clic, touche Entrée répétée) :
    // le bouton est déjà désactivé, mais `ngSubmit` peut aussi venir du
    // clavier, d'où cette garde dans le code.
    if (this.uploading()) return;

    const file = this.selectedFile();
    // Vérification AVANT l'appel HTTP (mêmes règles que le backend).
    const validationError = validateAudioFile(file);
    if (validationError || !file) {
      this.fileError.set(validationError);
      console.warn('[TracksPage] Upload bloqué côté client :', validationError);
      return;
    }

    if (this.title.invalid) {
      this.uploadState.set({ status: 'error', message: 'Le titre ne doit pas dépasser 120 caractères.' });
      return;
    }

    const title = this.title.value.trim() || file.name;
    this.fileError.set(null);
    // On passe tout de suite en « uploading » (0 %) pour désactiver les
    // contrôles AVANT même le premier événement HTTP.
    this.uploadState.set({ status: 'uploading', progress: 0, loaded: 0, total: file.size });
    this.title.disable();

    this.uploadRequest = this.service
      .upload(file, title)
      .pipe(finalize(() => this.title.enable()))
      .subscribe({
        next: (event) => {
          const state = uploadStateFromEvent(event);
          if (!state) return;

          this.uploadState.set(state);

          if (state.status === 'uploading') {
            // On ne journalise que des nombres : jamais le contenu du
            // fichier, ni le JWT (ajouté par l'intercepteur, invisible ici).
            console.debug(`[TracksPage] Upload : ${state.progress ?? '?'} % (${state.loaded} octets)`);
          } else if (state.status === 'success') {
            console.debug('[TracksPage] Piste envoyée', state.track.id);
            this.resetUploadForm();
            // Retour à la première page : les pistes sont triées par date
            // décroissante côté serveur, la nouvelle est donc en tête.
            this.page.set(1);
            this.load();
          }
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Envoi impossible', error);
          void httpErrorMessage(error, 'Envoi impossible').then((message) =>
            this.uploadState.set({ status: 'error', message }),
          );
        },
      });
  }

  private resetUploadForm(): void {
    this.title.reset('');
    this.selectedFile.set(null);
    // Un <input type="file"> ne se vide pas via Angular : on remet sa valeur à ''.
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  // ===================== TP3 Mission 5 : suppression =====================

  /** Vrai si la requête `DELETE` de cette piste est en cours. */
  isDeleting(trackId: string): boolean {
    return this.deletingIds().has(trackId);
  }

  /**
   * Étape 1 : clic sur « Supprimer » dans une card → confirmation.
   * Aucune requête n'est envoyée tant que l'utilisateur n'a pas confirmé.
   */
  confirmRemove(track: Track): void {
    if (this.isDeleting(track.id)) return;

    const data: ConfirmDialogData = {
      title: 'Supprimer cette piste ?',
      message: `« ${track.title} » et son fichier audio seront définitivement supprimés. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
    };

    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        data,
        // Le titre du dialogue sert de nom accessible à la boîte.
        ariaModal: true,
        autoFocus: 'first-tabbable',
        restoreFocus: true,
      })
      .afterClosed()
      .subscribe((confirmed) => {
        // `undefined` (Échap, clic extérieur) ou `false` (Annuler) : on ne fait rien.
        if (confirmed === true) {
          this.remove(track);
        } else {
          console.debug('[TracksPage] Suppression annulée', track.id);
        }
      });
  }

  /**
   * Étape 2 : après confirmation → `TrackService.remove()` → `DELETE /api/tracks/:id`.
   *
   * Le composant ne connaît ni l'URL ni `HttpClient` : uniquement le service.
   * L'interface (bouton masqué, guard) n'est PAS une sécurité : c'est le
   * backend qui vérifie le JWT (middleware `auth`) puis que la piste
   * appartient à `req.auth.sub` (`findOneAndDelete({ _id, ownerId })`).
   */
  remove(track: Track): void {
    // Anti double clic : une seule requête DELETE par piste à la fois.
    if (this.isDeleting(track.id)) return;
    this.setDeleting(track.id, true);
    console.debug('[TracksPage] Suppression demandée', track.id);

    this.service
      .remove(track.id)
      .pipe(finalize(() => this.setDeleting(track.id, false)))
      .subscribe({
        next: () => {
          console.debug('[TracksPage] Piste supprimée', track.id);
          this.stopIfPlaying(track.id);
          this.notifications.success(`« ${track.title} » a été supprimée.`);
          // Rafraîchir la page COURANTE depuis le serveur : une piste de la
          // page suivante « remonte », le total et le nombre de pages sont
          // recalculés. Si la page devient vide (dernière piste de la
          // dernière page), `load()` revient à la dernière page existante.
          this.load();
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Suppression impossible', error);

          if (error instanceof HttpErrorResponse && error.status === 404) {
            // La piste est affichée mais n'existe plus (supprimée dans un
            // autre onglet) ou n'appartient pas à l'utilisateur. Le backend
            // répond 404 dans les deux cas. L'écran est donc périmé :
            // on le resynchronise avec le serveur.
            this.stopIfPlaying(track.id);
            this.notifications.error(
              `« ${track.title} » n’existe plus ou ne vous appartient pas. La liste a été actualisée.`,
            );
            this.load();
            return;
          }

          // 401 : `unauthorizedInterceptor` déconnecte déjà et renvoie vers
          // /login ; on affiche quand même la raison. Autres cas (500,
          // serveur injoignable…) : message du serveur, la liste ne change pas.
          void httpErrorMessage(error, `Impossible de supprimer « ${track.title} »`).then((message) =>
            this.notifications.error(message),
          );
        },
      });
  }

  private setDeleting(trackId: string, deleting: boolean): void {
    this.deletingIds.update((ids) => {
      const next = new Set(ids);
      if (deleting) {
        next.add(trackId);
      } else {
        next.delete(trackId);
      }
      return next;
    });
  }

  /** Si la piste supprimée est dans le lecteur, on l'arrête et on libère le Blob. */
  private stopIfPlaying(trackId: string): void {
    if (this.currentTrack()?.id === trackId) {
      this.revokeAudioUrl();
      this.currentTrack.set(null);
    }
  }

  // ====================== Mission 3 : lecture audio ======================

  play(track: Track): void {
    this.audioRequest?.unsubscribe();
    this.loadingTrackId.set(track.id);
    this.audioError.set(null);

    this.audioRequest = this.service
      .audio(track.id)
      .pipe(finalize(() => this.loadingTrackId.set(null)))
      .subscribe({
        next: (blob) => {
          console.debug(`[TracksPage] Audio reçu (${blob.type}, ${blob.size} octets)`, track.id);
          // On révoque l'ancienne URL AVANT d'en créer une nouvelle.
          this.revokeAudioUrl();
          this.audioUrl.set(URL.createObjectURL(blob));
          this.currentTrack.set(track);
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Lecture impossible', error);
          void httpErrorMessage(error, `Impossible de lire « ${track.title} »`).then((message) =>
            this.audioError.set(message),
          );
        },
      });
  }

  /** Erreur levée par l'élément `<audio>` lui-même (décodage, format…). */
  onAudioError(event: Event): void {
    const media = (event.target as HTMLAudioElement).error;
    console.error('[TracksPage] Erreur du lecteur audio', media?.code, media?.message);
    const reasons: Record<number, string> = {
      1: 'la lecture a été interrompue',
      2: 'erreur réseau pendant la lecture',
      3: 'le fichier audio est corrompu ou ne peut pas être décodé',
      4: 'ce format audio n’est pas pris en charge par votre navigateur',
    };
    const reason = (media && reasons[media.code]) || 'erreur inconnue';
    this.audioError.set(`Lecture impossible de « ${this.currentTrack()?.title ?? 'la piste'} » : ${reason}.`);
  }

  /** Le navigateur peut refuser `autoplay` : ce n'est pas une erreur du fichier. */
  onAudioPlay(): void {
    this.audioError.set(null);
  }

  private revokeAudioUrl(): void {
    const previousUrl = this.audioUrl();
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      console.debug('[TracksPage] ObjectURL révoquée');
    }
    this.audioUrl.set(null);
  }
}
