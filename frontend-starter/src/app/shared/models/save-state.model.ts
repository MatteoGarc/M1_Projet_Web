/**
 * Étapes de la sauvegarde d'un enregistrement (union discriminée, comme
 * `UploadState`) :
 * - `rendering` : mélange des prises avec leurs effets ;
 * - `encoding`  : conversion en MP3 dans le navigateur ;
 * - `uploading` : envoi du MP3 au serveur (`POST /api/tracks`) ;
 * - `error`     : échec, message lisible.
 * Après un succès, la page redirige vers la bibliothèque.
 */
export type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'rendering' }
  | { readonly status: 'encoding'; readonly progress: number }
  | { readonly status: 'uploading'; readonly progress: number | null }
  | { readonly status: 'error'; readonly message: string };

export const SAVE_IDLE: SaveState = { status: 'idle' };
