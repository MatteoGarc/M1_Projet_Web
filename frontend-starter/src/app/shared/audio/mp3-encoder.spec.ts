import { describe, expect, it, vi } from 'vitest';
import { encodeMp3, estimateMp3Size } from './mp3-encoder';

/** Une seconde de La 440 Hz. */
function sine(sampleRate: number, seconds: number): Float32Array {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  return data;
}

/** jsdom ne fournit pas `Blob.arrayBuffer()` : lecture via `FileReader`. */
function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('encodeMp3', () => {
  it('produit un Blob audio/mpeg commençant par une trame MP3 valide', async () => {
    const tone = sine(44_100, 1);
    const progress = vi.fn();

    const blob = await encodeMp3({ sampleRate: 44_100, channels: [tone, tone] }, progress);

    expect(blob.type).toBe('audio/mpeg');
    const bytes = await readBytes(blob);
    // Mot de synchronisation MPEG : 11 bits à 1.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
    // 1 s à 192 kbit/s ≈ 24 Ko.
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(bytes.length).toBeLessThan(30_000);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('accepte un son mono', async () => {
    const blob = await encodeMp3({ sampleRate: 44_100, channels: [sine(44_100, 0.2)] });
    expect(blob.size).toBeGreaterThan(0);
  });

  it('refuse un son sans canal', async () => {
    await expect(encodeMp3({ sampleRate: 44_100, channels: [] })).rejects.toThrow('Son vide');
  });

  it('estime la taille : 60 s à 192 kbit/s = 1,44 Mo', () => {
    expect(estimateMp3Size(60)).toBe(1_440_000);
  });
});
