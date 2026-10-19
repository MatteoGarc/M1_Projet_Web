import { MIN_TAKE_LENGTH, Take } from '../models/take.model';

/**
 * Calculs de temps d'une prise : fonctions PURES, sans Web Audio, pour
 * pouvoir les tester simplement (`take-timing.spec.ts`).
 *
 * Vocabulaire :
 * - « passage » : la partie conservée du son, entre `trimStart` et `trimEnd` ;
 * - « durée jouée » : le passage × nombre de répétitions si la boucle est active ;
 * - « morceau » : toutes les prises mélangées, chacune démarrant à son `offset`.
 */
export type TakeTiming = Pick<Take, 'trimStart' | 'trimEnd' | 'loop' | 'repeats' | 'offset'>;

/** Durée du passage conservé (en secondes). */
export function segmentDuration(take: TakeTiming): number {
  return Math.max(0, take.trimEnd - take.trimStart);
}

/** Durée réellement jouée, répétitions comprises. */
export function playedDuration(take: TakeTiming): number {
  return segmentDuration(take) * (take.loop ? Math.max(1, Math.round(take.repeats)) : 1);
}

/** Instant où la prise se termine dans le morceau. */
export function takeEnd(take: TakeTiming): number {
  return take.offset + playedDuration(take);
}

/** Durée du morceau : fin de la dernière prise audible. */
export function projectDuration(takes: readonly (TakeTiming & { muted: boolean })[]): number {
  return takes.filter((take) => !take.muted).reduce((end, take) => Math.max(end, takeEnd(take)), 0);
}

/** Paramètres à passer à `AudioBufferSourceNode.start(when, offset, duration)`. */
export interface SourceSchedule {
  /** Attente avant de démarrer, par rapport au début de la lecture (s). */
  readonly delay: number;
  /** Position de départ dans le son brut (s). */
  readonly bufferOffset: number;
  /** Durée totale à jouer, boucles comprises (s). */
  readonly duration: number;
}

/**
 * Calcule comment démarrer une prise quand la lecture du morceau commence
 * à la position `from` (en secondes).
 *
 * @returns `null` si la prise est déjà terminée à cette position.
 */
export function scheduleFrom(take: TakeTiming, from: number): SourceSchedule | null {
  const segment = segmentDuration(take);
  if (segment <= 0) return null;

  const total = playedDuration(take);
  const elapsed = from - take.offset;

  if (elapsed >= total) return null;

  if (elapsed <= 0) {
    return { delay: -elapsed, bufferOffset: take.trimStart, duration: total };
  }

  // Lecture reprise au milieu de la prise (éventuellement au milieu d'une boucle).
  return {
    delay: 0,
    bufferOffset: take.trimStart + (elapsed % segment),
    duration: total - elapsed,
  };
}

/**
 * Corrige une coupe pour qu'elle reste dans le son et garde au moins
 * `MIN_TAKE_LENGTH` secondes. `moved` indique la poignée que l'utilisateur
 * vient de déplacer : c'est elle qui est bloquée, jamais l'autre.
 */
export function clampTrim(
  trimStart: number,
  trimEnd: number,
  bufferDuration: number,
  moved: 'start' | 'end',
): { trimStart: number; trimEnd: number } {
  const end = Math.min(bufferDuration, Math.max(0, trimEnd));
  const start = Math.min(bufferDuration, Math.max(0, trimStart));

  if (moved === 'start') {
    return { trimStart: Math.min(start, Math.max(0, end - MIN_TAKE_LENGTH)), trimEnd: end };
  }
  return { trimStart: start, trimEnd: Math.max(end, Math.min(bufferDuration, start + MIN_TAKE_LENGTH)) };
}

/** Formate une durée en `m:ss.d` (ex. 75.34 → « 1:15.3 »). */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
