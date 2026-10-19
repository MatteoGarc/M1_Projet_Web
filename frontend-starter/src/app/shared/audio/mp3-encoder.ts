import { Mp3Encoder } from '@breezystack/lamejs';

/** Son PCM à encoder : un `Float32Array` (valeurs -1 → 1) par canal. */
export interface PcmAudio {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** Débit du MP3 : 192 kbit/s ≈ 1,4 Mo par minute (la limite serveur est 25 Mo). */
export const MP3_KBPS = 192;

/** Taille approximative du MP3 pour une durée donnée, en octets. */
export function estimateMp3Size(seconds: number, kbps = MP3_KBPS): number {
  return Math.ceil((seconds * kbps * 1000) / 8);
}

/** Taille d'une trame MP3 (fixée par la norme MPEG-1 Layer III). */
const FRAME = 1152;
/** Nombre de trames encodées entre deux pauses rendues au navigateur. */
const FRAMES_PER_SLICE = 200;

/**
 * Encode un son PCM en MP3 dans le navigateur (le navigateur sait
 * ENREGISTRER en WebM/Opus, mais pas en MP3 : on utilise la bibliothèque
 * `lamejs`, portage JavaScript de l'encodeur LAME).
 *
 * L'encodage est découpé en tranches séparées par un `setTimeout(0)` :
 * l'interface reste réactive et la barre de progression avance.
 *
 * @param onProgress reçoit un pourcentage de 0 à 100.
 */
export async function encodeMp3(
  audio: PcmAudio,
  onProgress: (percent: number) => void = () => undefined,
  kbps = MP3_KBPS,
): Promise<Blob> {
  const left = audio.channels[0];
  if (!left) throw new Error('Son vide : rien à encoder.');
  const right = audio.channels[1];
  const stereo = right !== undefined;

  const encoder = new Mp3Encoder(stereo ? 2 : 1, audio.sampleRate, kbps);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const keep = (chunk: Uint8Array | Int8Array): void => {
    if (chunk.length > 0) parts.push(new Uint8Array(chunk));
  };

  const total = left.length;
  for (let start = 0; start < total; start += FRAME * FRAMES_PER_SLICE) {
    const sliceEnd = Math.min(total, start + FRAME * FRAMES_PER_SLICE);
    for (let i = start; i < sliceEnd; i += FRAME) {
      const end = Math.min(sliceEnd, i + FRAME);
      const l = toInt16(left, i, end);
      keep(stereo ? encoder.encodeBuffer(l, toInt16(right, i, end)) : encoder.encodeBuffer(l));
    }
    onProgress(Math.round((100 * sliceEnd) / total));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  keep(encoder.flush());

  return new Blob(parts, { type: 'audio/mpeg' });
}

/** Convertit des échantillons flottants (-1 → 1) en entiers 16 bits. */
function toInt16(samples: Float32Array, start: number, end: number): Int16Array {
  const out = new Int16Array(end - start);
  for (let i = start; i < end; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i - start] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
