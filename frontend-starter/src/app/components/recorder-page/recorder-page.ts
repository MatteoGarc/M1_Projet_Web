import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBar } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MixPlayer } from '../../shared/audio/mix-player';
import { estimateMp3Size, encodeMp3 } from '../../shared/audio/mp3-encoder';
import { renderDuration, renderMix } from '../../shared/audio/render-mix';
import { TakeRecorder } from '../../shared/audio/take-recorder';
import { formatTime, projectDuration } from '../../shared/audio/take-timing';
import { HasUnsavedChanges } from '../../shared/guards/unsaved-changes.guard';
import { ConfirmDialogData } from '../../shared/models/confirm-dialog-data.model';
import { SAVE_IDLE, SaveState } from '../../shared/models/save-state.model';
import { createTake, Take, TakePatch } from '../../shared/models/take.model';
import { FileSizePipe } from '../../shared/pipes/file-size.pipe';
import { AudioInputService, closeStream, mediaErrorMessage } from '../../shared/services/audio-input.service';
import { NotificationService } from '../../shared/services/notification.service';
import { TrackService } from '../../shared/services/track.service';
import { httpErrorMessage } from '../../shared/utils/http-error-message';
import { uploadStateFromEvent } from '../../shared/utils/upload-state';
import { MAX_AUDIO_SIZE, validateAudioFile } from '../../shared/validators/audio-file.validator';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { TakeEditorComponent } from '../take-editor/take-editor';

/** Une couleur par prise, pour les repérer d'un coup d'œil. */
const TAKE_COLORS = ['#1d755e', '#c0562b', '#3b5bdb', '#9c36b5', '#8a6d00', '#0c7a8c'];

/**
 * Page « Enregistrer un MP3 » :
 * 1. choix de l'entrée audio + vumètre ;
 * 2. enregistrement d'une prise (pause / reprise en direct), en écoutant
 *    éventuellement les prises précédentes (superposition : mélodie, puis
 *    beat, puis voix…) ;
 * 3. édition légère de chaque prise (coupe, boucle, volume, effets) avec
 *    écoute du mélange en direct ;
 * 4. sauvegarde : mélange → MP3 → `POST /api/tracks` (même route que
 *    l'import : aucune modification du backend).
 *
 * Tout l'audio reste dans le navigateur jusqu'à la sauvegarde.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink, MatProgressBar, FileSizePipe, TakeEditorComponent],
  templateUrl: './recorder-page.html',
  styleUrl: './recorder-page.css',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class RecorderPageComponent implements HasUnsavedChanges {
  private readonly audioInputs = inject(AudioInputService);
  private readonly trackService = inject(TrackService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly format = formatTime;
  readonly supported = this.audioInputs.isSupported() && TakeRecorder.isSupported();

  // ------------------------------------------------------------ Entrée audio
  readonly inputs = this.audioInputs.inputs;
  readonly selectedInput = signal<string | null>(null);
  readonly voiceProcessing = signal(false);
  readonly stream = signal<MediaStream | null>(null);
  readonly inputError = signal<string | null>(null);
  readonly opening = signal(false);
  /** Niveau du micro, 0 → 1 (vumètre). */
  readonly level = signal(0);
  readonly clipping = signal(false);

  // ---------------------------------------------------------- Enregistrement
  readonly recorder = new TakeRecorder();
  readonly recording = computed(() => this.recorder.status() !== 'inactive');
  /** Écouter les prises existantes pendant qu'on enregistre la suivante. */
  readonly monitor = signal(true);
  /** Décodage de la prise qui vient d'être enregistrée. */
  readonly processing = signal(false);
  readonly recordError = signal<string | null>(null);

  // ------------------------------------------------------------------ Prises
  readonly takes = signal<Take[]>([]);
  readonly player = new MixPlayer(() => this.audioContext());
  readonly duration = computed(() => projectDuration(this.takes()));
  readonly hasAudible = computed(() => this.duration() > 0);
  private takeCounter = 0;
  private refreshFrame = 0;

  // -------------------------------------------------------------- Sauvegarde
  readonly title = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] });
  /** `FormGroupDirective` capte `(ngSubmit)` et empêche le rechargement de la page. */
  readonly saveForm = new FormGroup({ title: this.title });
  readonly saveState = signal<SaveState>(SAVE_IDLE);
  readonly saving = computed(() => ['rendering', 'encoding', 'uploading'].includes(this.saveState().status));
  readonly estimatedSize = computed(() => estimateMp3Size(renderDuration(this.takes())));
  readonly tooBig = computed(() => this.estimatedSize() > MAX_AUDIO_SIZE);
  private readonly saved = signal(false);
  private uploadRequest?: Subscription;

  /** Contrôles d'édition bloqués pendant un enregistrement ou une sauvegarde. */
  readonly busy = computed(() => this.recording() || this.processing() || this.saving());

  private context: AudioContext | null = null;
  private meterSource: MediaStreamAudioSourceNode | null = null;
  private meterFrame = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.recorder.cancel();
      this.player.dispose();
      this.uploadRequest?.unsubscribe();
      this.stopMeter();
      closeStream(this.stream());
      cancelAnimationFrame(this.refreshFrame);
      void this.context?.close();
      console.debug('[RecorderPage] Destruction : micro coupé, audio libéré');
    });
  }

  takeColor(index: number): string {
    return TAKE_COLORS[index % TAKE_COLORS.length];
  }

  // ============================== Entrée audio ==============================

  /** Premier clic : demande l'autorisation du micro et affiche les entrées. */
  enableInput(): Promise<void> {
    return this.openInput(this.selectedInput());
  }

  changeInput(event: Event): void {
    void this.openInput((event.target as HTMLSelectElement).value || null);
  }

  toggleVoiceProcessing(event: Event): void {
    this.voiceProcessing.set((event.target as HTMLInputElement).checked);
    if (this.stream()) void this.openInput(this.selectedInput());
  }

  private async openInput(deviceId: string | null): Promise<void> {
    if (this.recording()) return;
    this.opening.set(true);
    this.inputError.set(null);
    this.stopMeter();
    closeStream(this.stream());
    this.stream.set(null);

    try {
      const stream = await this.audioInputs.open(deviceId, this.voiceProcessing());
      this.stream.set(stream);
      // L'entrée réellement ouverte (utile quand on a demandé « par défaut »).
      this.selectedInput.set(stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId);
      this.startMeter(stream);
    } catch (error: unknown) {
      console.error('[RecorderPage] Ouverture de l’entrée impossible', error);
      this.inputError.set(mediaErrorMessage(error));
    } finally {
      this.opening.set(false);
    }
  }

  private audioContext(): AudioContext {
    // Créé au premier clic : les navigateurs bloquent le son sans geste utilisateur.
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    return this.context;
  }

  private startMeter(stream: MediaStream): void {
    const context = this.audioContext();
    void context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    this.meterSource = context.createMediaStreamSource(stream);
    // Vers l'analyseur uniquement, PAS vers les haut-parleurs (larsen).
    this.meterSource.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let clipUntil = 0;
    const loop = (now: number): void => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      // Retombée progressive : l'aiguille ne « tremble » pas.
      this.level.set(Math.max(peak, this.level() * 0.92));
      if (peak > 0.98) clipUntil = now + 1500;
      this.clipping.set(now < clipUntil);
      this.meterFrame = requestAnimationFrame(loop);
    };
    this.meterFrame = requestAnimationFrame(loop);
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.meterFrame);
    this.meterSource?.disconnect();
    this.meterSource = null;
    this.level.set(0);
    this.clipping.set(false);
  }

  // ============================= Enregistrement =============================

  startRecording(): void {
    const stream = this.stream();
    if (!stream || this.busy()) return;
    this.recordError.set(null);
    this.player.stop();

    try {
      // Superposition : les prises existantes repartent du début, et la
      // nouvelle prise sera placée au même instant 0.
      if (this.monitor() && this.hasAudible()) {
        void this.player.play(this.takes(), 0);
      }
      this.recorder.start(stream);
      console.debug('[RecorderPage] Enregistrement démarré');
    } catch (error: unknown) {
      console.error('[RecorderPage] Démarrage impossible', error);
      this.player.stop();
      this.recordError.set(error instanceof Error ? error.message : 'Enregistrement impossible.');
    }
  }

  pauseRecording(): void {
    this.recorder.pause();
    this.player.pause();
  }

  resumeRecording(): void {
    this.recorder.resume();
    // On reprend l'accompagnement exactement là où en est la prise.
    if (this.monitor() && this.hasAudible()) {
      void this.player.play(this.takes(), this.recorder.elapsed());
    }
  }

  async stopRecording(): Promise<void> {
    this.player.stop();
    this.processing.set(true);
    try {
      const blob = await this.recorder.stop();
      console.debug(`[RecorderPage] Prise terminée (${blob.type}, ${blob.size} octets)`);
      const buffer = await this.audioContext().decodeAudioData(await blob.arrayBuffer());
      this.takeCounter++;
      this.takes.update((takes) => [...takes, createTake(buffer, `Prise ${this.takeCounter}`)]);
      this.saved.set(false);
    } catch (error: unknown) {
      console.error('[RecorderPage] Prise inutilisable', error);
      this.recordError.set(error instanceof Error ? error.message : 'La prise n’a pas pu être décodée.');
    } finally {
      this.processing.set(false);
    }
  }

  toggleMonitor(event: Event): void {
    this.monitor.set((event.target as HTMLInputElement).checked);
  }

  // ================================ Prises ==================================

  updateTake(id: string, patch: TakePatch): void {
    this.takes.update((takes) => takes.map((take) => (take.id === id ? { ...take, ...patch } : take)));
    this.saved.set(false);
    // Plusieurs mouvements de curseur dans la même image → un seul redémarrage.
    cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = requestAnimationFrame(() => this.player.refresh(this.takes()));
  }

  removeTake(take: Take): void {
    const data: ConfirmDialogData = {
      title: 'Supprimer cette prise ?',
      message: `« ${take.name} » sera retirée de l’enregistrement.`,
      confirmLabel: 'Supprimer',
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data, restoreFocus: true })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed !== true) return;
        this.takes.update((takes) => takes.filter((t) => t.id !== take.id));
        if (this.takes().length === 0) {
          this.player.stop();
        } else {
          this.player.refresh(this.takes());
        }
      });
  }

  togglePlay(): void {
    if (this.player.playing()) {
      this.player.pause();
    } else {
      void this.player.play(this.takes());
    }
  }

  seek(event: Event): void {
    this.player.seek((event.target as HTMLInputElement).valueAsNumber);
  }

  // =============================== Sauvegarde ===============================

  async save(): Promise<void> {
    if (this.busy()) return;
    const takes = this.takes();

    if (!this.hasAudible()) {
      this.saveState.set({ status: 'error', message: 'Aucune prise audible à sauvegarder.' });
      return;
    }
    if (this.tooBig()) {
      this.saveState.set({ status: 'error', message: 'Le morceau est trop long : le MP3 dépasserait 25 Mo.' });
      return;
    }
    if (this.title.invalid) {
      this.saveState.set({ status: 'error', message: 'Le titre ne doit pas dépasser 120 caractères.' });
      return;
    }

    const title = this.title.value.trim() || `Enregistrement du ${new Date().toLocaleString('fr-FR')}`;
    this.player.stop();
    this.title.disable();
    this.saveState.set({ status: 'rendering' });

    let file: File;
    try {
      const mix = await renderMix(takes);
      this.saveState.set({ status: 'encoding', progress: 0 });
      const mp3 = await encodeMp3(
        { sampleRate: mix.sampleRate, channels: [mix.getChannelData(0), mix.getChannelData(1)] },
        (progress) => this.saveState.set({ status: 'encoding', progress }),
      );
      file = new File([mp3], `${fileName(title)}.mp3`, { type: 'audio/mpeg' });
      console.debug(`[RecorderPage] MP3 prêt : ${file.size} octets`);
    } catch (error: unknown) {
      console.error('[RecorderPage] Création du MP3 impossible', error);
      this.title.enable();
      this.saveState.set({ status: 'error', message: error instanceof Error ? error.message : 'Création du MP3 impossible.' });
      return;
    }

    // Mêmes règles que pour un import (taille, type) : le backend les revérifie.
    const invalid = validateAudioFile(file);
    if (invalid) {
      this.title.enable();
      this.saveState.set({ status: 'error', message: invalid });
      return;
    }

    this.saveState.set({ status: 'uploading', progress: 0 });
    this.uploadRequest = this.trackService.upload(file, title).subscribe({
      next: (event) => {
        const state = uploadStateFromEvent(event);
        if (state?.status === 'uploading') {
          this.saveState.set({ status: 'uploading', progress: state.progress });
        } else if (state?.status === 'success') {
          console.debug('[RecorderPage] Enregistrement sauvegardé', state.track.id);
          this.saved.set(true);
          this.notifications.success(`« ${state.track.title} » a été ajoutée à votre bibliothèque.`);
          void this.router.navigateByUrl('/tracks');
        } else if (state?.status === 'error') {
          this.title.enable();
          this.saveState.set({ status: 'error', message: state.message });
        }
      },
      error: (error: unknown) => {
        console.error('[RecorderPage] Envoi impossible', error);
        this.title.enable();
        void httpErrorMessage(error, 'Sauvegarde impossible').then((message) =>
          this.saveState.set({ status: 'error', message }),
        );
      },
    });
  }

  // ========================= Travail non sauvegardé =========================

  hasUnsavedChanges(): boolean {
    return this.takes().length > 0 && !this.saved();
  }

  /** Fermeture / rechargement de l'onglet : le navigateur affiche sa propre alerte. */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges() || this.recording()) event.preventDefault();
  }
}

/** Nom de fichier sûr à partir du titre (le titre complet reste dans `title`). */
function fileName(title: string): string {
  const safe = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return safe || 'enregistrement';
}
