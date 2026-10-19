import { Component, computed, input, output } from '@angular/core';
import { clampTrim, formatTime, playedDuration, segmentDuration } from '../../shared/audio/take-timing';
import { Take, TakeEffects, TakeFilter, TakePatch } from '../../shared/models/take.model';
import { WaveformComponent } from '../waveform/waveform';

type NumericEffect = 'filterFrequency' | 'echo' | 'echoTime' | 'reverb' | 'distortion';

/**
 * Carte d'édition d'UNE prise : nom, coupe, boucle, décalage, volume,
 * effets. Composant de présentation pur : il ne joue aucun son et n'a
 * aucun état propre ; il émet des modifications (`changed`) que la page
 * applique à sa liste de prises, puis la page lui renvoie la prise à jour.
 */
@Component({
  selector: 'app-take-editor',
  imports: [WaveformComponent],
  templateUrl: './take-editor.html',
  styleUrl: './take-editor.css',
})
export class TakeEditorComponent {
  readonly take = input.required<Take>();
  readonly color = input('#1d755e');
  /** Désactive les contrôles (enregistrement ou sauvegarde en cours). */
  readonly disabled = input(false);

  readonly changed = output<TakePatch>();
  readonly removed = output<void>();

  readonly duration = computed(() => this.take().buffer.duration);
  readonly kept = computed(() => segmentDuration(this.take()));
  readonly played = computed(() => playedDuration(this.take()));
  readonly format = formatTime;

  readonly filters: readonly { value: TakeFilter; label: string }[] = [
    { value: 'none', label: 'Aucun' },
    { value: 'lowpass', label: 'Passe-bas (son étouffé)' },
    { value: 'highpass', label: 'Passe-haut (son fin, type radio)' },
  ];

  rename(event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    this.changed.emit({ name: name || 'Prise sans nom' });
  }

  trim(edge: 'start' | 'end', event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    const take = this.take();
    const next =
      edge === 'start'
        ? clampTrim(value, take.trimEnd, take.buffer.duration, 'start')
        : clampTrim(take.trimStart, value, take.buffer.duration, 'end');
    // La poignée a pu être bloquée : on remet le curseur à la valeur réelle.
    (event.target as HTMLInputElement).valueAsNumber = edge === 'start' ? next.trimStart : next.trimEnd;
    this.changed.emit(next);
  }

  resetTrim(): void {
    this.changed.emit({ trimStart: 0, trimEnd: this.take().buffer.duration });
  }

  toggleLoop(event: Event): void {
    this.changed.emit({ loop: (event.target as HTMLInputElement).checked });
  }

  setRepeats(event: Event): void {
    const value = Math.round((event.target as HTMLInputElement).valueAsNumber);
    if (Number.isFinite(value)) this.changed.emit({ repeats: Math.min(64, Math.max(2, value)) });
  }

  setOffset(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) this.changed.emit({ offset: Math.min(600, Math.max(0, value)) });
  }

  setVolume(event: Event): void {
    this.changed.emit({ volume: (event.target as HTMLInputElement).valueAsNumber / 100 });
  }

  toggleMute(): void {
    this.changed.emit({ muted: !this.take().muted });
  }

  setFilter(event: Event): void {
    this.patchEffects({ filter: (event.target as HTMLSelectElement).value as TakeFilter });
  }

  setEffect(key: NumericEffect, event: Event, scale = 1): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) this.patchEffects({ [key]: value / scale });
  }

  private patchEffects(patch: Partial<TakeEffects>): void {
    this.changed.emit({ effects: { ...this.take().effects, ...patch } });
  }
}
