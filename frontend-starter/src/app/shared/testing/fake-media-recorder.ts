/**
 * Faux `MediaRecorder` pour les tests unitaires (absent de jsdom).
 *
 * Il suit les mêmes transitions d'état que le vrai (`inactive` →
 * `recording` ⇄ `paused` → `inactive`) et laisse le test décider des
 * données « enregistrées » (`pending`) et d'une éventuelle erreur à l'arrêt.
 *
 * Utilisation : `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)`.
 * Fichier utilisé uniquement par les `*.spec.ts`.
 */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported: string[] = ['audio/webm;codecs=opus', 'audio/webm'];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  /** Réinitialise l'état partagé entre deux tests. */
  static reset(): void {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
  }

  static last(): FakeMediaRecorder {
    const recorder = FakeMediaRecorder.instances.at(-1);
    if (!recorder) throw new Error('Aucun MediaRecorder créé');
    return recorder;
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice: number | undefined;
  /** Données que le navigateur « produit » à l'arrêt. */
  pending: Blob[] = [new Blob(['opus-data'], { type: 'audio/webm' })];
  failOnStop = false;

  constructor(
    readonly stream: MediaStream,
    readonly options?: { mimeType?: string },
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  get mimeType(): string {
    return this.options?.mimeType ?? '';
  }

  start(timeslice?: number): void {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    if (this.failOnStop) {
      this.onerror?.();
      return;
    }
    for (const data of this.pending) this.ondataavailable?.({ data });
    this.onstop?.();
  }
}
