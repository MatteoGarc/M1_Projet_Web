import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTake, NO_EFFECTS, Take } from '../models/take.model';
import { FakeBufferSourceNode, FakeOfflineAudioContext, fakeAudioBuffer } from '../testing/fake-web-audio';
import { EFFECT_TAIL_SECONDS } from './take-graph';
import { EXPORT_SAMPLE_RATE, renderDuration, renderMix } from './render-mix';

/** `renderMix` produit le son stéréo final, encodé ensuite en MP3. */
describe('render-mix', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeOfflineAudioContext.last = null;
  });

  const take = (patch: Partial<Take> = {}): Take => ({ ...createTake(fakeAudioBuffer(2), 'Prise'), ...patch });

  it('durée du rendu : fin de la dernière prise audible', () => {
    expect(renderDuration([])).toBe(0);
    expect(renderDuration([take(), take({ offset: 1 })])).toBe(3);
  });

  it('ajoute une traîne quand un écho ou une réverb doit s’éteindre', () => {
    expect(renderDuration([take({ effects: { ...NO_EFFECTS, echo: 0.5 } })])).toBe(2 + EFFECT_TAIL_SECONDS);
  });

  it('refuse de rendre un morceau sans prise audible', async () => {
    await expect(renderMix([take({ muted: true })])).rejects.toThrow('Aucune prise audible à sauvegarder.');
  });

  it('rend en stéréo 44,1 kHz et démarre chaque prise audible à 0', async () => {
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

    const mix = await renderMix([take(), take({ offset: 0.5 }), take({ muted: true })]);

    const offline = FakeOfflineAudioContext.last;
    expect(offline?.channels).toBe(2);
    expect(offline?.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    expect(offline?.length).toBe(Math.ceil(2.5 * EXPORT_SAMPLE_RATE));
    const sources = offline?.nodesOf(FakeBufferSourceNode) ?? [];
    expect(sources.map((s) => s.started?.[0])).toEqual([0, 0.5]);
    expect(mix.numberOfChannels).toBe(2);
    expect(mix.duration).toBeCloseTo(2.5, 5);
  });
});
