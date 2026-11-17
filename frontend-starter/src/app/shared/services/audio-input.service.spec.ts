import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioInputService, closeStream, mediaErrorMessage } from './audio-input.service';

/**
 * `AudioInputService` dialogue avec `navigator.mediaDevices` (absent de
 * jsdom) : on le remplace par un faux qui renvoie des entrées audio
 * choisies par le test. Aucun vrai micro n'est sollicité.
 */
describe('AudioInputService', () => {
  let service: AudioInputService;
  let devices: Partial<MediaDeviceInfo>[];
  const getUserMedia = vi.fn();
  const addEventListener = vi.fn();
  const fakeTrack = { label: 'Micro USB', stop: vi.fn() };
  const fakeStream = { getAudioTracks: () => [fakeTrack], getTracks: () => [fakeTrack] } as unknown as MediaStream;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    getUserMedia.mockReset().mockResolvedValue(fakeStream);
    addEventListener.mockReset();
    devices = [
      { kind: 'audioinput', deviceId: 'default', label: 'Micro intégré' },
      { kind: 'audioinput', deviceId: 'usb', label: '' },
      { kind: 'audioinput', deviceId: '', label: '' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Webcam' },
      { kind: 'audiooutput', deviceId: 'hp', label: 'Haut-parleurs' },
    ];
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: () => Promise.resolve(devices), addEventListener },
    });
    service = TestBed.inject(AudioInputService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('isSupported : vrai seulement si getUserMedia existe', () => {
    expect(service.isSupported()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(service.isSupported()).toBe(false);
  });

  it('open : traitement de la voix désactivé par défaut pour un instrument', async () => {
    const stream = await service.open('usb', false);

    expect(stream).toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: { exact: 'usb' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
  });

  it('open(null, true) : entrée par défaut avec réduction de bruit', async () => {
    await service.open(null, true);
    const constraints = getUserMedia.mock.calls[0][0] as { audio: MediaTrackConstraints };
    expect(constraints.audio.deviceId).toBeUndefined();
    expect(constraints.audio.noiseSuppression).toBe(true);
  });

  it('liste uniquement les entrées audio identifiées, avec un nom de secours', async () => {
    await service.open(null, false);
    expect(service.inputs()).toEqual([
      { deviceId: 'default', label: 'Micro intégré' },
      { deviceId: 'usb', label: 'Entrée audio 2' },
    ]);
  });

  it('écoute les branchements une seule fois, même après plusieurs ouvertures', async () => {
    await service.open(null, false);
    await service.open('usb', false);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });

  it('relit la liste quand un micro est branché', async () => {
    await service.open(null, false);
    devices.push({ kind: 'audioinput', deviceId: 'carte-son', label: 'Carte son' });

    const onChange = addEventListener.mock.calls[0][1] as () => void;
    onChange();
    await vi.waitFor(() => expect(service.inputs()).toHaveLength(3));
  });

  it('propage l’erreur de getUserMedia (autorisation refusée)', async () => {
    getUserMedia.mockRejectedValue(new DOMException('refus', 'NotAllowedError'));
    await expect(service.open(null, false)).rejects.toThrow('refus');
  });
});

describe('closeStream', () => {
  it('arrête toutes les pistes du flux (le voyant du micro s’éteint)', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    closeStream({ getTracks: () => tracks } as unknown as MediaStream);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('ne fait rien sans flux', () => {
    expect(() => closeStream(null)).not.toThrow();
  });
});

describe('mediaErrorMessage', () => {
  it.each([
    ['NotAllowedError', 'Accès au micro refusé'],
    ['SecurityError', 'Accès au micro refusé'],
    ['NotFoundError', 'Aucune entrée audio trouvée'],
    ['NotReadableError', 'déjà utilisée par une autre application'],
    ['OverconstrainedError', 'n’est plus disponible'],
  ])('%s → message explicite', (name, expected) => {
    expect(mediaErrorMessage(new DOMException('détail technique', name))).toContain(expected);
  });

  it('autre erreur : message d’origine, ou texte générique', () => {
    expect(mediaErrorMessage(new Error('Plantage du pilote'))).toBe('Plantage du pilote');
    expect(mediaErrorMessage('???')).toBe('Impossible d’accéder au micro.');
  });
});
