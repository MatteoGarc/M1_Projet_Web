import { Take } from '../models/take.model';
import { scheduleFrom } from './take-timing';

/**
 * Construit le circuit Web Audio d'une prise :
 *
 *   source (boucle + coupe) → filtre → distorsion → volume ─┬─────────────→ sortie
 *                                                          ├→ écho ──────→ sortie
 *                                                          └→ réverb ────→ sortie
 *
 * La MÊME fonction sert à l'écoute en direct (`AudioContext`) et au rendu
 * de la sauvegarde (`OfflineAudioContext`) : ce que l'on entend dans
 * l'éditeur est donc exactement ce qui sera enregistré dans le MP3.
 *
 * @param startAt instant (horloge du contexte) correspondant à la position `from`.
 * @param from    position de lecture dans le morceau, en secondes.
 * @returns la source démarrée, ou `null` si la prise est muette ou déjà finie.
 */
export function connectTake(
  context: BaseAudioContext,
  take: Take,
  output: AudioNode,
  startAt: number,
  from: number,
): AudioBufferSourceNode | null {
  if (take.muted) return null;
  const schedule = scheduleFrom(take, from);
  if (!schedule) return null;

  const source = context.createBufferSource();
  source.buffer = take.buffer;
  if (take.loop) {
    // La boucle native rejoue uniquement le passage conservé.
    source.loop = true;
    source.loopStart = take.trimStart;
    source.loopEnd = take.trimEnd;
  }

  let node: AudioNode = source;
  const { effects } = take;

  if (effects.filter !== 'none') {
    const filter = context.createBiquadFilter();
    filter.type = effects.filter;
    filter.frequency.value = effects.filterFrequency;
    node = node.connect(filter);
  }

  if (effects.distortion > 0) {
    const shaper = context.createWaveShaper();
    shaper.curve = distortionCurve(effects.distortion);
    shaper.oversample = '4x';
    node = node.connect(shaper);
  }

  // Volume + micro-fondus (8 ms) au début et à la fin : évite les « clics »
  // produits par une coupure nette au milieu d'une onde.
  const when = startAt + schedule.delay;
  const end = when + schedule.duration;
  const fade = Math.min(0.008, schedule.duration / 4);
  const volume = context.createGain();
  volume.gain.setValueAtTime(0, when);
  volume.gain.linearRampToValueAtTime(take.volume, when + fade);
  volume.gain.setValueAtTime(take.volume, end - fade);
  volume.gain.linearRampToValueAtTime(0, end);
  node.connect(volume);
  volume.connect(output);

  if (effects.echo > 0) {
    const delay = context.createDelay(2);
    delay.delayTime.value = effects.echoTime;
    const feedback = context.createGain();
    feedback.gain.value = 0.45;
    const wet = context.createGain();
    wet.gain.value = effects.echo;
    volume.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(output);
  }

  if (effects.reverb > 0) {
    const convolver = context.createConvolver();
    convolver.buffer = reverbImpulse(context);
    const wet = context.createGain();
    wet.gain.value = effects.reverb;
    volume.connect(convolver).connect(wet).connect(output);
  }

  source.start(when, schedule.bufferOffset, schedule.duration);
  return source;
}

/**
 * Bus de sortie commun : un compresseur rapide sert de « limiteur » pour
 * éviter la saturation quand plusieurs prises fortes s'additionnent.
 */
export function createMasterBus(context: BaseAudioContext): AudioNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  limiter.connect(context.destination);
  return limiter;
}

/** Durée ajoutée en fin de rendu pour laisser s'éteindre écho et réverb. */
export const EFFECT_TAIL_SECONDS = 2.5;

export function hasTail(take: Take): boolean {
  return !take.muted && (take.effects.echo > 0 || take.effects.reverb > 0);
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 200;
  const samples = 2048;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Réponse impulsionnelle générée (bruit qui décroît) : pas de fichier à charger. */
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();

function reverbImpulse(context: BaseAudioContext): AudioBuffer {
  const cached = impulses.get(context);
  if (cached) return cached;

  const seconds = 2.2;
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3) * 0.5;
    }
  }
  impulses.set(context, impulse);
  return impulse;
}
