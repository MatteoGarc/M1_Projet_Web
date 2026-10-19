import { Take } from '../models/take.model';
import { connectTake, createMasterBus, EFFECT_TAIL_SECONDS, hasTail } from './take-graph';
import { projectDuration } from './take-timing';

/** Fréquence d'échantillonnage du MP3 final (qualité CD). */
export const EXPORT_SAMPLE_RATE = 44_100;

/** Durée du rendu : morceau + traîne des effets éventuels. */
export function renderDuration(takes: readonly Take[]): number {
  const duration = projectDuration(takes);
  return duration > 0 && takes.some(hasTail) ? duration + EFFECT_TAIL_SECONDS : duration;
}

/**
 * Mélange toutes les prises (coupes, boucles, volumes et effets appliqués)
 * dans un seul son stéréo.
 *
 * `OfflineAudioContext` exécute le même circuit qu'à l'écoute, mais aussi
 * vite que possible et sans haut-parleur : le résultat est un `AudioBuffer`.
 */
export async function renderMix(takes: readonly Take[]): Promise<AudioBuffer> {
  const duration = renderDuration(takes);
  if (duration <= 0) {
    throw new Error('Aucune prise audible à sauvegarder.');
  }

  const context = new OfflineAudioContext(2, Math.ceil(duration * EXPORT_SAMPLE_RATE), EXPORT_SAMPLE_RATE);
  const master = createMasterBus(context);
  for (const take of takes) {
    connectTake(context, take, master, 0, 0);
  }
  return context.startRendering();
}
