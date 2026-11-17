import { describe, expect, it } from 'vitest';
import { FileSizePipe } from './file-size.pipe';

/** Le backend renvoie `size` en OCTETS : le pipe choisit l'unité lisible. */
describe('FileSizePipe', () => {
  const pipe = new FileSizePipe();

  it('affiche un tiret quand la taille est inconnue', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
    expect(pipe.transform(Number.NaN)).toBe('—');
  });

  it('octets en dessous de 1 Ko', () => {
    expect(pipe.transform(0)).toBe('0 o');
    expect(pipe.transform(1023)).toBe('1023 o');
  });

  it('kilo-octets avec une décimale à la française', () => {
    expect(pipe.transform(1024)).toBe('1 Ko');
    expect(pipe.transform(1536)).toBe('1,5 Ko');
  });

  it('mégaoctets avec une décimale à la française', () => {
    expect(pipe.transform(1024 * 1024)).toBe('1 Mo');
    expect(pipe.transform(3_456_789)).toBe('3,3 Mo');
    expect(pipe.transform(25 * 1024 * 1024)).toBe('25 Mo');
  });
});
