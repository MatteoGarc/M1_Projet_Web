import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTake, Take } from '../models/take.model';
import { FakeAudioContext, FakeBufferSourceNode, FakeCompressorNode, fakeAudioBuffer } from '../testing/fake-web-audio';
import { MixPlayer } from './mix-player';

/**
 * `MixPlayer` joue le mélange des prises en direct. Les nœuds Web Audio ne
 * savent pas se mettre en pause : le lecteur mémorise la position et
 * reconstruit le circuit. On vérifie ici cette mécanique avec une horloge
 * contrôlée (`context.currentTime`) et des images (`requestAnimationFrame`)
 * déclenchées à la main.
 */
describe('MixPlayer', () => {
  let context: FakeAudioContext;
  let player: MixPlayer;
  let frames: FrameRequestCallback[];

  const take = (patch: Partial<Take> = {}): Take => ({ ...createTake(fakeAudioBuffer(2), 'Prise'), ...patch });
  const sources = () => context.nodesOf(FakeBufferSourceNode);
  const runFrame = () => frames.shift()?.(0);

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => frames.push(cb)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    context = new FakeAudioContext();
    context.currentTime = 5;
    player = new MixPlayer(() => context.asContext());
  });

  afterEach(() => {
    player.dispose();
    vi.unstubAllGlobals();
  });

  it('lit toutes les prises audibles ensemble, avec 30 ms d’avance', async () => {
    await player.play([take(), take(), take({ muted: true })], 0);

    expect(player.playing()).toBe(true);
    expect(player.position()).toBe(0);
    expect(sources()).toHaveLength(2);
    for (const source of sources()) expect(source.started?.[0]).toBeCloseTo(5.03, 10);
  });

  it('réveille un contexte suspendu (politique d’autoplay des navigateurs)', async () => {
    context.state = 'suspended';
    await player.play([take()]);
    expect(context.resumeCount).toBe(1);
  });

  it('repart du début si la position demandée est après la fin du morceau', async () => {
    await player.play([take()], 99);
    expect(player.position()).toBe(0);
  });

  it('pause : mémorise la position atteinte et arrête les sources', async () => {
    await player.play([take()], 0.5);
    context.currentTime = 5.03 + 0.7;

    player.pause();

    expect(player.playing()).toBe(false);
    expect(player.position()).toBeCloseTo(1.2, 10);
    expect(sources()[0].stopCount).toBe(1);
  });

  it('stop : arrête et revient à 0', async () => {
    await player.play([take()], 1);
    player.stop();
    expect(player.playing()).toBe(false);
    expect(player.position()).toBe(0);
  });

  it('seek à l’arrêt : déplace seulement la tête de lecture', () => {
    player.seek(1.5);
    expect(player.position()).toBe(1.5);
    expect(sources()).toHaveLength(0);
  });

  it('seek pendant la lecture : reconstruit le circuit à la nouvelle position', async () => {
    await player.play([take()], 0);
    player.seek(1.5);
    await Promise.resolve();

    expect(sources()).toHaveLength(2);
    expect(sources()[0].stopCount).toBe(1);
    expect(sources()[1].started?.[1]).toBe(1.5);
  });

  it('refresh : n’agit que pendant la lecture', async () => {
    player.refresh([take()]);
    expect(sources()).toHaveLength(0);

    await player.play([take()], 0);
    player.refresh([take({ volume: 0.2 })]);
    await Promise.resolve();
    expect(sources()).toHaveLength(2);
  });

  it('le bus de sortie (limiteur) n’est créé qu’une fois', async () => {
    await player.play([take()], 0);
    await player.play([take()], 0);
    expect(context.nodesOf(FakeCompressorNode)).toHaveLength(1);
  });

  it('avance la position à chaque image puis s’arrête à la fin du morceau', async () => {
    await player.play([take()], 0);

    context.currentTime = 5.03 + 1;
    runFrame();
    expect(player.position()).toBeCloseTo(1, 10);
    expect(player.playing()).toBe(true);

    context.currentTime = 5.03 + 2.5;
    runFrame();
    expect(player.playing()).toBe(false);
    expect(player.position()).toBe(0);
  });
});
