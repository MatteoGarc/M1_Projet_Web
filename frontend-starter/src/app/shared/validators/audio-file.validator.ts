/**
 * Règles de validation d'un fichier audio AVANT l'appel HTTP d'upload.
 *
 * Elles reprennent exactement les contrôles faits par le backend
 * (`backend/src/app.js`) :
 * - `MAX_FILE_SIZE = 25 * 1024 * 1024` → `limits.fileSize` de Multer ;
 * - `allowed` (Set de types MIME) → `fileFilter` de Multer ;
 * - `if (!req.file)` → « Fichier audio requis ».
 *
 * Cette validation frontend améliore l'expérience (message immédiat, pas
 * d'envoi inutile de 25 Mo sur le réseau) mais NE REMPLACE PAS la validation
 * backend : n'importe qui peut appeler l'API sans passer par Angular
 * (curl, Postman, DevTools), et `file.type` est déclaré par le navigateur
 * à partir de l'extension, il n'est pas une preuve du contenu réel.
 */

/** Taille maximale acceptée par le backend : 25 Mo (en octets). */
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

/** Types MIME acceptés par le backend (copie du Set `allowed`). */
export const ALLOWED_AUDIO_TYPES: readonly string[] = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
];

/** Valeur de l'attribut `accept` de l'`<input type="file">`. */
export const AUDIO_ACCEPT = ['.mp3', '.wav', '.ogg', '.m4a', ...ALLOWED_AUDIO_TYPES].join(',');

/**
 * Retourne un message d'erreur lisible si le fichier est invalide,
 * ou `null` s'il peut être envoyé.
 */
export function validateAudioFile(file: File | null | undefined): string | null {
  if (!file) {
    return 'Choisissez un fichier audio avant d’envoyer.';
  }

  if (file.size === 0) {
    return `Le fichier « ${file.name} » est vide.`;
  }

  if (file.size > MAX_AUDIO_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1).replace('.', ',');
    return `Le fichier « ${file.name} » fait ${sizeInMb} Mo : la limite est de 25 Mo.`;
  }

  // Le navigateur remplit `file.type` ; c'est cette même valeur qui sera
  // envoyée dans la partie multipart et lue par Multer (`file.mimetype`).
  if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
    return (
      `Format non accepté (${file.type || 'type inconnu'}). ` +
      'Formats acceptés : MP3, WAV, OGG et M4A.'
    );
  }

  return null;
}
