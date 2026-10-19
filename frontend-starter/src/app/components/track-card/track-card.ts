import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Track } from '../../shared/models/track.model';
import { FileSizePipe } from '../../shared/pipes/file-size.pipe';

const FORMAT_LABELS: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
};

/**
 * Card d'une piste : titre, nom original, format, taille, date d'ajout,
 * action de lecture et (TP3 Mission 5) action de suppression.
 * Composant de présentation pur : il ne fait aucun appel HTTP, il émet
 * seulement `play` et `remove` vers la page parente, qui décide quoi faire
 * (confirmation, appel à `TrackService`, rafraîchissement).
 */
@Component({
  selector: 'app-track-card',
  imports: [DatePipe, FileSizePipe],
  templateUrl: './track-card.html',
  styleUrl: './track-card.css',
})
export class TrackCardComponent {
  readonly track = input.required<Track>();
  /** Vrai si cette piste est celle actuellement dans le lecteur. */
  readonly playing = input(false);
  /** Vrai pendant le téléchargement du Blob de cette piste. */
  readonly loadingAudio = input(false);

  /** TP3 — vrai pendant la requête `DELETE` de cette piste (anti double clic). */
  readonly deleting = input(false);

  readonly play = output<Track>();
  /** TP3 — demande de suppression ; la confirmation est faite par la page. */
  readonly remove = output<Track>();

  readonly format = computed(() => FORMAT_LABELS[this.track().mimeType] ?? this.track().mimeType);
}
