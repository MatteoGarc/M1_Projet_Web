import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAudioBuffer } from '../../shared/testing/fake-web-audio';
import { WaveformComponent } from './waveform';

/**
 * jsdom ne sait pas dessiner : on fournit un faux contexte 2D qui
 * mémorise les couleurs utilisées pour chaque barre.
 */
describe('WaveformComponent', () => {
  let fixture: ComponentFixture<WaveformComponent>;
  let fills: string[];
  const context = {
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(function (this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    }),
  };

  beforeEach(() => {
    fills = [];
    context.clearRect.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    fixture = TestBed.createComponent(WaveformComponent);
    fixture.componentRef.setInput('buffer', fakeAudioBuffer(2));
  });

  afterEach(() => vi.restoreAllMocks());

  it('dessine 400 barres et deux repères de coupe', () => {
    fixture.componentRef.setInput('trimEnd', 2);
    fixture.detectChanges();

    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(fills).toHaveLength(400 + 2);
    expect(fills.slice(-2)).toEqual(['#123d32', '#123d32']);
  });

  it('colore la partie conservée et grise la partie coupée', () => {
    fixture.componentRef.setInput('trimStart', 1);
    fixture.componentRef.setInput('trimEnd', 2);
    fixture.componentRef.setInput('color', '#c0562b');
    fixture.detectChanges();

    const bars = fills.slice(0, 400);
    expect(bars.slice(0, 200).every((c) => c === '#b8cbc5')).toBe(true);
    expect(bars.slice(200).every((c) => c === '#c0562b')).toBe(true);
  });

  it('redessine quand la coupe change', () => {
    fixture.componentRef.setInput('trimEnd', 2);
    fixture.detectChanges();
    fixture.componentRef.setInput('trimEnd', 1);
    fixture.detectChanges();
    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });

  it('expose une description accessible', () => {
    fixture.componentRef.setInput('label', 'Forme d’onde de Voix');
    fixture.detectChanges();
    const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe('Forme d’onde de Voix');
  });
});
