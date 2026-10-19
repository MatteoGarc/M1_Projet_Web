import { Component, computed, effect, ElementRef, input, viewChild } from '@angular/core';
import { computePeaks } from '../../shared/audio/waveform-peaks';

/** Nombre de barres calculées (indépendant de la largeur affichée). */
const BUCKETS = 400;

/**
 * Forme d'onde d'une prise. La partie conservée par la coupe est colorée,
 * la partie retirée est grisée. Composant d'affichage pur.
 */
@Component({
  selector: 'app-waveform',
  template: `<canvas #canvas role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `
    :host { display: block; }
    canvas { display: block; width: 100%; height: 72px; background: #f1f8f5; border-radius: 8px; }
  `,
})
export class WaveformComponent {
  readonly buffer = input.required<AudioBuffer>();
  readonly trimStart = input(0);
  readonly trimEnd = input(0);
  readonly color = input('#1d755e');
  readonly label = input('Forme d’onde de la prise');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** Calculé une seule fois par prise : le son brut ne change jamais. */
  private readonly peaks = computed(() => computePeaks(this.buffer().getChannelData(0), BUCKETS));

  constructor() {
    effect(() => this.draw());
  }

  private draw(): void {
    const canvas = this.canvas().nativeElement;
    const peaks = this.peaks();
    const duration = this.buffer().duration;
    const start = this.trimStart() / duration;
    const end = this.trimEnd() / duration;
    const color = this.color();

    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round((canvas.clientWidth || 600) * ratio));
    const height = Math.max(1, Math.round((canvas.clientHeight || 72) * ratio));
    canvas.width = width;
    canvas.height = height;

    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, width, height);

    // Normalisation : une prise enregistrée faiblement reste lisible.
    const loudest = peaks.reduce((max, value) => Math.max(max, value), 0.01);
    const bar = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const position = (i + 0.5) / peaks.length;
      const h = Math.max(1, (peaks[i] / loudest) * (height * 0.9));
      g.fillStyle = position >= start && position <= end ? color : '#b8cbc5';
      g.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - ratio * 0.5), h);
    }

    // Repères de coupe.
    g.fillStyle = '#123d32';
    g.fillRect(start * width - ratio, 0, 2 * ratio, height);
    g.fillRect(end * width - ratio, 0, 2 * ratio, height);
  }
}
