/**
 * Une « prise » (take) enregistrée dans l'enregistreur.
 *
 * Le son brut (`buffer`) n'est JAMAIS modifié : couper, boucler ou ajouter
 * des effets ne change que les réglages ci-dessous. Le rendu final
 * (`renderMix`) applique ces réglages au moment de la sauvegarde ; on peut
 * donc revenir en arrière à tout moment (édition non destructive).
 */
export interface Take {
  readonly id: string;
  /** Son décodé (PCM) de la prise, tel qu'il a été enregistré. */
  readonly buffer: AudioBuffer;
  readonly name: string;
  /** Début du passage conservé, en secondes dans `buffer`. */
  readonly trimStart: number;
  /** Fin du passage conservé, en secondes dans `buffer`. */
  readonly trimEnd: number;
  /** Rejouer le passage conservé plusieurs fois à la suite. */
  readonly loop: boolean;
  /** Nombre total de lectures quand `loop` est vrai (≥ 2). */
  readonly repeats: number;
  /** Instant de départ de la prise dans le morceau, en secondes. */
  readonly offset: number;
  /** Volume linéaire : 1 = volume d'origine, 0 = silence, 1.5 = +50 %. */
  readonly volume: number;
  readonly muted: boolean;
  readonly effects: TakeEffects;
}

export type TakeFilter = 'none' | 'lowpass' | 'highpass';

/** Effets simples, chacun désactivé quand sa valeur vaut 0 (ou `none`). */
export interface TakeEffects {
  readonly filter: TakeFilter;
  /** Fréquence de coupure du filtre, en Hz. */
  readonly filterFrequency: number;
  /** Quantité d'écho mélangée au son (0 → 1). */
  readonly echo: number;
  /** Délai entre deux répétitions de l'écho, en secondes. */
  readonly echoTime: number;
  /** Quantité de réverbération (0 → 1). */
  readonly reverb: number;
  /** Saturation / distorsion (0 → 1). */
  readonly distortion: number;
}

/** Réglages modifiables depuis l'éditeur (tout sauf l'identité et le son). */
export type TakePatch = Partial<Omit<Take, 'id' | 'buffer'>>;

export const NO_EFFECTS: TakeEffects = {
  filter: 'none',
  filterFrequency: 1200,
  echo: 0,
  echoTime: 0.3,
  reverb: 0,
  distortion: 0,
};

/** Longueur minimale du passage conservé, pour ne jamais obtenir une prise vide. */
export const MIN_TAKE_LENGTH = 0.05;

/** Crée une prise avec des réglages neutres : tout le son, sans boucle ni effet. */
export function createTake(buffer: AudioBuffer, name: string): Take {
  return {
    id: crypto.randomUUID(),
    buffer,
    name,
    trimStart: 0,
    trimEnd: buffer.duration,
    loop: false,
    repeats: 2,
    offset: 0,
    volume: 1,
    muted: false,
    effects: NO_EFFECTS,
  };
}
