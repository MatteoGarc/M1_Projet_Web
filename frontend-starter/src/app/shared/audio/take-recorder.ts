import { signal } from '@angular/core';

export type RecorderStatus = 'inactive' | 'recording' | 'paused';

/** Formats essayés dans l'ordre : le navigateur choisit le premier qu'il sait produire. */
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/**
 * Enregistre un flux micro avec `MediaRecorder` (comme un enregistreur vocal).
 *
 * - `pause()` / `resume()` : le fichier produit est continu, sans le silence
 *   de la pause ;
 * - `elapsed` : durée réellement enregistrée (pauses exclues).
 *
 * Le navigateur enregistre en WebM/Opus (ou MP4 sur Safari). Ce n'est pas
 * un problème : la prise est ensuite décodée en PCM pour l'édition, et le
 * MP3 n'est produit qu'à la sauvegarde.
 */
export class TakeRecorder {
  readonly status = signal<RecorderStatus>('inactive');
  readonly elapsed = signal(0);

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private accumulated = 0;
  private resumedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  static isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  start(stream: MediaStream): void {
    if (this.recorder) throw new Error('Un enregistrement est déjà en cours.');

    const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    // Un morceau toutes les secondes : rien n'est perdu si l'onglet ralentit.
    this.recorder.start(1000);

    this.accumulated = 0;
    this.resumedAt = performance.now();
    this.elapsed.set(0);
    this.status.set('recording');
    this.timer = setInterval(() => this.elapsed.set(this.currentElapsed()), 100);
  }

  pause(): void {
    if (this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    this.accumulated = this.currentElapsed();
    this.elapsed.set(this.accumulated);
    this.status.set('paused');
  }

  resume(): void {
    if (this.recorder?.state !== 'paused') return;
    this.recorder.resume();
    this.resumedAt = performance.now();
    this.status.set('recording');
  }

  /** Termine l'enregistrement et renvoie le fichier complet. */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Aucun enregistrement en cours.'));

    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.reset();
        if (blob.size === 0) {
          reject(new Error('L’enregistrement est vide.'));
        } else {
          resolve(blob);
        }
      };
      recorder.onerror = () => {
        this.reset();
        reject(new Error('Erreur du navigateur pendant l’enregistrement.'));
      };
      recorder.stop();
    });
  }

  /** Abandonne l'enregistrement en cours (quitter la page, changer d'entrée…). */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.reset();
  }

  private currentElapsed(): number {
    return this.status() === 'recording'
      ? this.accumulated + (performance.now() - this.resumedAt) / 1000
      : this.accumulated;
  }

  private reset(): void {
    clearInterval(this.timer);
    this.recorder = null;
    this.chunks = [];
    this.status.set('inactive');
  }
}
