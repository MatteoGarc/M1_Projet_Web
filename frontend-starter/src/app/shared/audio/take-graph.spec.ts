import { describe, expect, it } from 'vitest';
import { createTake, NO_EFFECTS, Take } from '../models/take.model';
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeBiquadFilterNode,
  FakeBufferSourceNode,
  FakeCompressorNode,
  FakeConvolverNode,
  FakeDelayNode,
  FakeGainNode,
  FakeWaveShaperNode,
  fakeAudioBuffer,
} from '../testing/fake-web-audio';
import { connectTake, createMasterBus, hasTail } from './take-graph';

/**
 * `connectTake` construit le circuit Web Audio d'une prise. Il sert à la
 * fois à l'écoute en direct et au rendu du MP3 : si le circuit est faux,
 * le fichier sauvegardé l'est aussi.
 */
describe('take-graph', () => {
  const take = (patch: Partial<Take> = {}): Take => ({ ...createTake(fakeAudioBuffer(2), 'Prise 1'), ...patch });

  function connect(t: Take, startAt = 10, from = 0) {
    const context = new FakeAudioContext();
    const output = new FakeAudioNode('output');
    const source = connectTake(context.asContext(), t, output as unknown as AudioNode, startAt, from);
    return { context, output, source: source as unknown as FakeBufferSourceNode | null };
  }

  it('createTake : réglages neutres, tout le son conservé', () => {
    const t = createTake(fakeAudioBuffer(2), 'Voix');
    expect(t).toMatchObject({
      name: 'Voix',
      trimStart: 0,
      trimEnd: 2,
      loop: false,
      offset: 0,
      volume: 1,
      muted: false,
      effects: NO_EFFECTS,
    });
    expect(t.id).not.toBe(createTake(fakeAudioBuffer(2), 'Voix').id);
  });

  it('prise muette : aucun nœud créé', () => {
    const { source, context } = connect(take({ muted: true }));
    expect(source).toBeNull();
    expect(context.nodes).toHaveLength(0);
  });

  it('prise déjà terminée à la position demandée : rien n’est joué', () => {
    const { source } = connect(take(), 10, 5);
    expect(source).toBeNull();
  });

  it('sans effet : source → volume → sortie, démarrée au bon instant sur le passage conservé', () => {
    const { source, output, context } = connect(take({ trimStart: 0.2, trimEnd: 0.8, offset: 1, volume: 0.5 }));

    expect(source?.started).toEqual([11, 0.2, expect.closeTo(0.6, 10)]);
    const [volume] = context.nodesOf(FakeGainNode);
    expect(source?.connections).toEqual([volume]);
    expect(volume.connections).toEqual([output]);
    // Micro-fondus de 8 ms au début et à la fin (évite les « clics »).
    expect(volume.gain.events[0]).toEqual(['set', 0, 11]);
    expect(volume.gain.events[1]).toEqual(['ramp', 0.5, expect.closeTo(11.008, 10)]);
    expect(volume.gain.events[3][0]).toBe('ramp');
    expect(volume.gain.events[3][1]).toBe(0);
    expect(volume.gain.events[3][2]).toBeCloseTo(11.6, 10);
    expect(context.nodesOf(FakeBiquadFilterNode)).toHaveLength(0);
    expect(context.nodesOf(FakeDelayNode)).toHaveLength(0);
  });

  it('boucle : la source native rejoue uniquement le passage conservé', () => {
    const { source } = connect(take({ trimStart: 0.5, trimEnd: 1.5, loop: true, repeats: 3 }));
    expect(source).toMatchObject({ loop: true, loopStart: 0.5, loopEnd: 1.5 });
    // 3 répétitions d'une seconde.
    expect(source?.started).toEqual([10, 0.5, 3]);
  });

  it('filtre puis distorsion sont insérés avant le volume, dans cet ordre', () => {
    const { source, context } = connect(
      take({ effects: { ...NO_EFFECTS, filter: 'highpass', filterFrequency: 2000, distortion: 0.5 } }),
    );
    const [filter] = context.nodesOf(FakeBiquadFilterNode);
    const [shaper] = context.nodesOf(FakeWaveShaperNode);
    const [volume] = context.nodesOf(FakeGainNode);

    expect(filter.type).toBe('highpass');
    expect(filter.frequency.value).toBe(2000);
    expect(shaper.curve).toBeInstanceOf(Float32Array);
    expect(shaper.oversample).toBe('4x');
    expect(source?.connections).toEqual([filter]);
    expect(filter.connections).toEqual([shaper]);
    expect(shaper.connections).toEqual([volume]);
  });

  it('écho et réverbération : branches « wet » parallèles vers la sortie', () => {
    const { context, output } = connect(take({ effects: { ...NO_EFFECTS, echo: 0.4, echoTime: 0.25, reverb: 0.3 } }));
    const [delay] = context.nodesOf(FakeDelayNode);
    const [convolver] = context.nodesOf(FakeConvolverNode);
    const gains = context.nodesOf(FakeGainNode);
    const [volume] = gains;

    expect(delay.delayTime.value).toBe(0.25);
    expect(convolver.buffer).not.toBeNull();
    expect(volume.connections).toEqual(expect.arrayContaining([output, delay, convolver]));
    const wets = gains.filter((g) => g.connections.includes(output) && g !== volume);
    expect(wets.map((g) => g.gain.value).sort()).toEqual([0.3, 0.4]);
  });

  it('bus de sortie : limiteur branché sur les haut-parleurs', () => {
    const context = new FakeAudioContext();
    const master = createMasterBus(context.asContext()) as unknown as FakeCompressorNode;
    expect(master.threshold.value).toBe(-3);
    expect(master.ratio.value).toBe(20);
    expect(master.connections).toEqual([context.destination]);
  });

  it('hasTail : seules les prises audibles avec écho ou réverb prolongent le rendu', () => {
    expect(hasTail(take())).toBe(false);
    expect(hasTail(take({ effects: { ...NO_EFFECTS, echo: 0.1 } }))).toBe(true);
    expect(hasTail(take({ effects: { ...NO_EFFECTS, reverb: 0.1 } }))).toBe(true);
    expect(hasTail(take({ muted: true, effects: { ...NO_EFFECTS, reverb: 0.1 } }))).toBe(false);
  });
});
