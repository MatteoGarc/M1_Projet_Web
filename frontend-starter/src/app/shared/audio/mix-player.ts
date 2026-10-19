import { signal } from '@angular/core';
import { Take } from '../models/take.model';
import { connectTake, createMasterBus } from './take-graph';
import { projectDuration } from './take-timing';

/**
 * Lecteur du morceau en cours d'édition : joue toutes les prises ensemble
 * avec leurs réglages, en direct, dans un `AudioContext`.
 *
 * Les nœuds Web Audio ne se « mettent pas en pause » : pour mettre en pause
 * on arrête les sources en mémorisant la position, et pour reprendre (ou
 * appliquer un réglage modifié pendant la lecture) on reconstruit le
 * circuit à partir de cette position. C'est quasi instantané.
 */
export class MixPlayer {
  /** Vrai pendant la lecture. */
  readonly playing = signal(false);
  /** Position de lecture dans le morceau (s), mise à jour à chaque image. */
  readonly position = signal(0);

  private sources: AudioBufferSourceNode[] = [];
  private bus: GainNode | null = null;
  /** Limiteur de sortie, créé une seule fois. */
  private master: AudioNode | null = null;
  private takes: readonly Take[] = [];
  /** Horloge du contexte au moment où la position `from` a été jouée. */
  private startedAt = 0;
  private from = 0;
  private duration = 0;
  private frame = 0;

  constructor(private readonly context: () => AudioContext) {}

  /** Lit le morceau à partir de `from` secondes (par défaut : position courante). */
  async play(takes: readonly Take[], from = this.position()): Promise<void> {
    const context = this.context();
    if (context.state === 'suspended') await context.resume();

    this.disconnect();
    this.takes = takes;
    this.duration = projectDuration(takes);
    this.from = from >= this.duration ? 0 : Math.max(0, from);
    // Petite avance (30 ms) pour que toutes les sources démarrent ensemble.
    this.startedAt = context.currentTime + 0.03;

    // Un gain intermédiaire par lecture : le couper arrête aussi l'écho et la
    // réverb encore en train de résonner.
    this.master ??= createMasterBus(context);
    this.bus = context.createGain();
    this.bus.connect(this.master);
    for (const take of takes) {
      const source = connectTake(context, take, this.bus, this.startedAt, this.from);
      if (source) this.sources.push(source);
    }

    this.position.set(this.from);
    this.playing.set(true);
    this.tick();
  }

  /** Réglages modifiés pendant la lecture : on repart de la position actuelle. */
  refresh(takes: readonly Take[]): void {
    if (this.playing()) void this.play(takes, this.currentPosition());
  }

  pause(): void {
    if (!this.playing()) return;
    this.position.set(this.currentPosition());
    this.halt();
  }

  stop(): void {
    this.halt();
    this.position.set(0);
  }

  /** Déplace la tête de lecture (et continue de jouer si on jouait). */
  seek(seconds: number): void {
    if (this.playing()) {
      void this.play(this.takes, seconds);
    } else {
      this.position.set(Math.max(0, seconds));
    }
  }

  dispose(): void {
    this.halt();
  }

  private currentPosition(): number {
    return this.from + Math.max(0, this.context().currentTime - this.startedAt);
  }

  private halt(): void {
    cancelAnimationFrame(this.frame);
    this.disconnect();
    this.playing.set(false);
  }

  private disconnect(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source jamais démarrée ou déjà arrêtée : rien à faire.
      }
    }
    this.sources = [];
    this.bus?.disconnect();
    this.bus = null;
  }

  private tick(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.playing()) return;
      const position = this.currentPosition();
      if (position >= this.duration) {
        // Fin du morceau : retour au début, comme un lecteur classique.
        this.stop();
        return;
      }
      this.position.set(position);
      this.tick();
    });
  }
}
