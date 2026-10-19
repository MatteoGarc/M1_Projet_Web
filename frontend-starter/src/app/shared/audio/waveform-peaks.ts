/**
 * Réduit un son à `buckets` valeurs (amplitude maximale de chaque tranche),
 * de quoi dessiner une forme d'onde sans parcourir tout le son à chaque image.
 */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(Math.max(0, buckets));
  if (samples.length === 0 || buckets <= 0) return peaks;

  const size = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let max = 0;
    for (let i = start; i < end && i < samples.length; i++) {
      const value = Math.abs(samples[i]);
      if (value > max) max = value;
    }
    peaks[b] = max;
  }
  return peaks;
}
