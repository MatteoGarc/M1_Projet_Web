import { describe, expect, it } from 'vitest';
import { clampTrim, formatTime, playedDuration, projectDuration, scheduleFrom, TakeTiming } from './take-timing';

const take = (patch: Partial<TakeTiming> = {}): TakeTiming => ({
  trimStart: 1,
  trimEnd: 3,
  loop: false,
  repeats: 4,
  offset: 0,
  ...patch,
});

describe('take-timing', () => {
  it('durée jouée : passage seul, ou passage × répétitions en boucle', () => {
    expect(playedDuration(take())).toBe(2);
    expect(playedDuration(take({ loop: true }))).toBe(8);
  });

  it('durée du morceau : ignore les prises muettes', () => {
    const takes = [
      { ...take({ offset: 1 }), muted: false }, // finit à 3
      { ...take({ loop: true }), muted: true }, // finirait à 8
    ];
    expect(projectDuration(takes)).toBe(3);
    expect(projectDuration([])).toBe(0);
  });

  it('planification depuis le début : attend l’offset puis joue tout le passage', () => {
    expect(scheduleFrom(take({ offset: 2 }), 0)).toEqual({ delay: 2, bufferOffset: 1, duration: 2 });
  });

  it('reprise au milieu d’une boucle : repart au bon endroit du passage', () => {
    // passage de 2 s répété 4 fois ; 5 s après le début → 3e boucle, +1 s.
    expect(scheduleFrom(take({ loop: true }), 5)).toEqual({ delay: 0, bufferOffset: 2, duration: 3 });
  });

  it('prise déjà terminée à la position demandée → null', () => {
    expect(scheduleFrom(take(), 2)).toBeNull();
    expect(scheduleFrom(take({ trimEnd: 1 }), 0)).toBeNull();
  });

  it('coupe : bloque la poignée déplacée et garde une longueur minimale', () => {
    expect(clampTrim(2.99, 3, 5, 'start')).toEqual({ trimStart: 2.95, trimEnd: 3 });
    expect(clampTrim(1, 0.5, 5, 'end')).toEqual({ trimStart: 1, trimEnd: 1.05 });
    expect(clampTrim(-1, 9, 5, 'end')).toEqual({ trimStart: 0, trimEnd: 5 });
  });

  it('format m:ss.d', () => {
    expect(formatTime(75.34)).toBe('1:15.3');
    expect(formatTime(4)).toBe('0:04.0');
  });
});
