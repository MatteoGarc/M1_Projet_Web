import { Track } from './track.model';

/**
 * TP3 Mission 6 — états possibles d'un upload.
 *
 * C'est une « union discriminée » TypeScript : le champ `status` indique
 * dans quel état on se trouve, et TypeScript sait alors quels autres champs
 * existent. Exemple : `state.progress` n'est accessible que si
 * `state.status === 'uploading'`. On ne peut donc pas avoir par erreur un
 * pourcentage ET un message d'erreur en même temps.
 *
 * Les quatre états demandés par le sujet :
 * - `idle`      : aucun upload en cours (état initial) ;
 * - `uploading` : envoi en cours, avec un pourcentage ;
 * - `success`   : le serveur a répondu `201` avec la piste créée ;
 * - `error`     : l'envoi a échoué (message lisible pour l'utilisateur).
 */
export type UploadState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'uploading';
      /**
       * Pourcentage 0–100, ou `null` si le navigateur ne connaît pas la
       * taille totale (barre « indéterminée » dans ce cas).
       */
      readonly progress: number | null;
      /** Octets déjà envoyés. */
      readonly loaded: number;
      /** Taille totale du corps multipart, si connue. */
      readonly total: number | null;
    }
  | { readonly status: 'success'; readonly track: Track }
  | { readonly status: 'error'; readonly message: string };

/** État initial, partagé pour éviter de recréer l'objet partout. */
export const UPLOAD_IDLE: UploadState = { status: 'idle' };
