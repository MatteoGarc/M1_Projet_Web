import { describe, expect, it } from 'vitest';
import { computePeaks } from './waveform-peaks';

describe('computePeaks', () => {
  it('garde l’amplitude maximale (absolue) de chaque tranche', () => {
    const samples = new Float32Array([0.1, -0.8, 0.2, 0.3, -0.1, 0.05]);
    expect([...computePeaks(samples, 3)].map((v) => +v.toFixed(2))).toEqual([0.8, 0.3, 0.1]);
  });

  it('gère un son vide ou plus de tranches que d’échantillons', () => {
    expect(computePeaks(new Float32Array(0), 4).length).toBe(4);
    expect([...computePeaks(new Float32Array([0.5]), 2)].map((v) => +v.toFixed(2))).toEqual([0.5, 0.5]);
  });
});
