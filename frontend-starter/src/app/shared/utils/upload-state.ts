import { HttpEvent, HttpEventType } from '@angular/common/http';
import { Track } from '../models/track.model';
import { UploadState } from '../models/upload-state.model';

/**
 * TP3 Mission 6 — transforme UN événement HTTP d'Angular en état d'upload.
 *
 * Avec `observe: 'events'` + `reportUploadProgress: true` (voir
 * `TrackService.upload`), l'Observable émet plusieurs `HttpEvent` dans cet
 * ordre :
 *
 * 1. `Sent`           : la requête vient de partir → 0 % ;
 * 2. `UploadProgress` : (plusieurs fois) `loaded` octets envoyés sur
 *                       `total` → pourcentage = round(100 × loaded / total) ;
 * 3. `ResponseHeader` : le serveur a commencé à répondre (statut connu) ;
 * 4. `DownloadProgress`: éventuellement, réception du corps de réponse ;
 * 5. `Response`       : réponse complète → `event.body` est le `Track`.
 *
 * Point important : 100 % signifie « tous les octets sont PARTIS du
 * navigateur », pas « le serveur a fini ». Entre 100 % et `Response`, Multer
 * écrit encore le fichier sur disque et Mongoose crée la métadonnée. Le
 * succès n'est donc déclaré qu'à l'événement `Response`.
 *
 * Les erreurs HTTP (400, 401, 413, 500…) ne passent PAS par cette fonction :
 * elles arrivent dans le callback `error` du `subscribe`.
 *
 * Fonction PURE (aucun effet de bord, aucune dépendance Angular injectée) :
 * elle se teste très simplement (`upload-state.spec.ts`).
 *
 * @returns le nouvel état, ou `null` si l'événement ne change rien à
 *          l'affichage (ex. `ResponseHeader`).
 */
export function uploadStateFromEvent(event: HttpEvent<Track>): UploadState | null {
  switch (event.type) {
    case HttpEventType.Sent:
      return { status: 'uploading', progress: 0, loaded: 0, total: null };

    case HttpEventType.UploadProgress: {
      // `total` peut être absent si le navigateur ne connaît pas la taille
      // du corps (cas rare avec FormData, mais prévu par le type Angular).
      const total = event.total ?? null;
      const progress = total ? Math.min(100, Math.round((100 * event.loaded) / total)) : null;
      return { status: 'uploading', progress, loaded: event.loaded, total };
    }

    case HttpEventType.Response:
      if (event.body) {
        return { status: 'success', track: event.body };
      }
      // Un 2xx sans corps ne respecte pas le contrat (`201 Track`).
      return { status: 'error', message: 'Réponse du serveur inattendue (piste absente).' };

    default:
      // ResponseHeader, DownloadProgress, User : rien à afficher.
      return null;
  }
}
