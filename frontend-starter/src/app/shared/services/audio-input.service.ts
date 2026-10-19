import { Injectable, signal } from '@angular/core';

/** Entrée audio proposée dans la liste de choix. */
export interface AudioInput {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * Accès aux entrées audio de l'ordinateur (micro intégré, carte son, interface
 * guitare USB, casque…).
 *
 * Particularité des navigateurs : tant que l'utilisateur n'a pas autorisé le
 * micro, `enumerateDevices()` renvoie des entrées SANS nom. On demande donc
 * d'abord l'autorisation (`open()`), puis on relit la liste.
 */
@Injectable({ providedIn: 'root' })
export class AudioInputService {
  readonly inputs = signal<AudioInput[]>([]);

  private listening = false;

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Ouvre une entrée audio.
   * @param deviceId entrée choisie, ou `null` pour l'entrée par défaut.
   * @param voiceProcessing active la réduction de bruit / d'écho et le gain
   *   automatique : utile pour la voix, mais déforme un instrument (désactivé
   *   par défaut pour la musique).
   */
  async open(deviceId: string | null, voiceProcessing: boolean): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: voiceProcessing,
        noiseSuppression: voiceProcessing,
        autoGainControl: voiceProcessing,
        channelCount: { ideal: 2 },
      },
    });
    console.debug('[AudioInputService] Entrée ouverte', stream.getAudioTracks()[0]?.label);
    await this.refresh();
    this.watchChanges();
    return stream;
  }

  /** Relit la liste des entrées (branchement / débranchement d'un micro). */
  async refresh(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Entrée audio ${index + 1}` }));
    this.inputs.set(inputs);
  }

  private watchChanges(): void {
    if (this.listening) return;
    this.listening = true;
    navigator.mediaDevices.addEventListener('devicechange', () => void this.refresh());
  }
}

/** Arrête toutes les pistes d'un flux (éteint le voyant du micro). */
export function closeStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Traduit une erreur `getUserMedia` en message lisible. */
export function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Accès au micro refusé. Autorisez-le dans la barre d’adresse du navigateur puis réessayez.';
    case 'NotFoundError':
      return 'Aucune entrée audio trouvée : branchez un micro ou une carte son.';
    case 'NotReadableError':
      return 'Cette entrée est déjà utilisée par une autre application.';
    case 'OverconstrainedError':
      return 'Cette entrée n’est plus disponible. Choisissez-en une autre.';
    default:
      return error instanceof Error ? error.message : 'Impossible d’accéder au micro.';
  }
}
