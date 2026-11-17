import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMediaRecorder } from '../testing/fake-media-recorder';
import { TakeRecorder } from './take-recorder';

/**
 * `TakeRecorder` pilote `MediaRecorder` (remplacé ici par un faux) et
 * mesure la durée enregistrée avec `performance.now()` (horloge contrôlée).
 */
describe('TakeRecorder', () => {
  const stream = {} as MediaStream;
  let now: number;
  let recorder: TakeRecorder;
  const current = () => FakeMediaRecorder.last();

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    FakeMediaRecorder.reset();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    recorder = new TakeRecorder();
  });

  afterEach(() => {
    recorder.cancel();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('isSupported dépend de la présence de MediaRecorder', () => {
    expect(TakeRecorder.isSupported()).toBe(true);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(TakeRecorder.isSupported()).toBe(false);
  });

  it('démarre avec le premier format supporté et des morceaux d’une seconde', () => {
    recorder.start(stream);
    expect(current().options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(current().timeslice).toBe(1000);
    expect(recorder.status()).toBe('recording');
  });

  it('laisse le navigateur choisir quand aucun format préféré n’est supporté', () => {
    FakeMediaRecorder.supported = [];
    recorder.start(stream);
    expect(current().options).toBeUndefined();
  });

  it('refuse un second enregistrement simultané', () => {
    recorder.start(stream);
    expect(() => recorder.start(stream)).toThrow('Un enregistrement est déjà en cours.');
  });

  it('la durée exclut les pauses', () => {
    recorder.start(stream);
    now = 2000;
    vi.advanceTimersByTime(100);
    expect(recorder.elapsed()).toBeCloseTo(2, 5);

    recorder.pause();
    expect(recorder.status()).toBe('paused');
    now = 10_000; // 8 s de pause
    vi.advanceTimersByTime(100);
    expect(recorder.elapsed()).toBeCloseTo(2, 5);

    recorder.resume();
    now = 11_500;
    vi.advanceTimersByTime(100);
    expect(recorder.elapsed()).toBeCloseTo(3.5, 5);
  });

  it('pause et reprise sont ignorées dans un état incohérent', () => {
    recorder.resume();
    recorder.pause();
    expect(recorder.status()).toBe('inactive');
  });

  it('stop : renvoie un seul fichier avec tous les morceaux, puis revient à inactive', async () => {
    recorder.start(stream);
    current().pending = [new Blob(['ab']), new Blob(['cd'])];

    const blob = await recorder.stop();

    expect(blob.size).toBe(4);
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(recorder.status()).toBe('inactive');
  });

  it('stop : rejette un enregistrement vide', async () => {
    recorder.start(stream);
    current().pending = [new Blob([])];
    await expect(recorder.stop()).rejects.toThrow('L’enregistrement est vide.');
  });

  it('stop : rejette une erreur du navigateur', async () => {
    recorder.start(stream);
    current().failOnStop = true;
    await expect(recorder.stop()).rejects.toThrow('Erreur du navigateur pendant l’enregistrement.');
    expect(recorder.status()).toBe('inactive');
  });

  it('stop sans enregistrement : rejette', async () => {
    await expect(recorder.stop()).rejects.toThrow('Aucun enregistrement en cours.');
  });

  it('cancel : arrête le MediaRecorder sans produire de fichier', () => {
    recorder.start(stream);
    const media = current();
    recorder.cancel();
    expect(media.state).toBe('inactive');
    expect(media.onstop).toBeNull();
    expect(recorder.status()).toBe('inactive');
  });
});
