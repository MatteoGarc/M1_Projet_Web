import { describe, expect, it } from 'vitest';
import { ALLOWED_AUDIO_TYPES, AUDIO_ACCEPT, MAX_AUDIO_SIZE, validateAudioFile } from './audio-file.validator';

/**
 * Tests du validateur d'upload : il doit refuser EXACTEMENT ce que refuse
 * le backend (`backend/src/app.js` : `MAX_FILE_SIZE` et le Set `allowed`),
 * pour que l'utilisateur ait un message immédiat sans requête HTTP inutile.
 *
 * Astuce : pour simuler un gros fichier sans allouer 25 Mo, on redéfinit
 * la propriété `size` d'un petit `File`.
 */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateAudioFile', () => {
  it('demande un fichier quand aucun n’est choisi', () => {
    expect(validateAudioFile(null)).toBe('Choisissez un fichier audio avant d’envoyer.');
    expect(validateAudioFile(undefined)).toBe('Choisissez un fichier audio avant d’envoyer.');
  });

  it('refuse un fichier vide', () => {
    expect(validateAudioFile(fakeFile('vide.mp3', 'audio/mpeg', 0))).toBe('Le fichier « vide.mp3 » est vide.');
  });

  it('accepte un fichier de exactement 25 Mo (limite incluse, comme Multer)', () => {
    expect(validateAudioFile(fakeFile('limite.mp3', 'audio/mpeg', MAX_AUDIO_SIZE))).toBeNull();
  });

  it('refuse un fichier de 25 Mo + 1 octet et affiche sa taille en Mo', () => {
    const message = validateAudioFile(fakeFile('gros.wav', 'audio/wav', MAX_AUDIO_SIZE + 1));
    expect(message).toBe('Le fichier « gros.wav » fait 25,0 Mo : la limite est de 25 Mo.');
  });

  it('affiche une taille arrondie au dixième avec une virgule', () => {
    const message = validateAudioFile(fakeFile('long.wav', 'audio/wav', 30.46 * 1024 * 1024));
    expect(message).toContain('fait 30,5 Mo');
  });

  it.each(ALLOWED_AUDIO_TYPES)('accepte le type MIME %s', (type) => {
    expect(validateAudioFile(fakeFile('piste', type, 1024))).toBeNull();
  });

  it.each([
    ['notes.txt', 'text/plain'],
    ['photo.png', 'image/png'],
    ['video.mp4', 'video/mp4'],
    ['piste.flac', 'audio/flac'],
  ])('refuse %s (%s)', (name, type) => {
    expect(validateAudioFile(fakeFile(name, type, 1024))).toBe(
      `Format non accepté (${type}). Formats acceptés : MP3, WAV, OGG et M4A.`,
    );
  });

  it('refuse un fichier dont le navigateur ne connaît pas le type', () => {
    expect(validateAudioFile(fakeFile('mystere', '', 1024))).toContain('Format non accepté (type inconnu)');
  });

  it('vérifie la taille AVANT le type (message le plus utile en premier)', () => {
    expect(validateAudioFile(fakeFile('gros.txt', 'text/plain', MAX_AUDIO_SIZE * 2))).toContain('la limite est de 25 Mo');
  });
});

describe('AUDIO_ACCEPT', () => {
  it('propose les extensions et tous les types MIME acceptés au sélecteur de fichier', () => {
    const accepted = AUDIO_ACCEPT.split(',');
    expect(accepted).toEqual(expect.arrayContaining(['.mp3', '.wav', '.ogg', '.m4a', ...ALLOWED_AUDIO_TYPES]));
  });
});
