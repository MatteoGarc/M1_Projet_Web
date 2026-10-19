import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';

/** Nombre de pistes par page demandé au serveur (le backend plafonne à 20). */
export const TRACKS_PAGE_SIZE = 5;

/**
 * Encapsule toutes les opérations HTTP sur les backing tracks.
 * Les composants n'appellent jamais `HttpClient` directement.
 */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  /**
   * Mission 2 — pagination SERVEUR.
   * `page` et `limit` sont réellement transmis dans l'URL :
   * `GET /api/tracks?page=2&limit=5`. Le backend fait `skip/limit` dans
   * MongoDB : Angular ne reçoit jamais plus d'une page de pistes.
   */
  list(page = 1, limit = TRACKS_PAGE_SIZE) {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http.get<Page<Track>>('/api/tracks', { params });
  }

  /**
   * Upload multipart : le `FormData` contient EXACTEMENT les deux champs
   * attendus par le backend (`upload.single("audio")` et `req.body.title`).
   * On ne fixe pas `Content-Type` : le navigateur ajoute lui-même
   * `multipart/form-data; boundary=...`.
   *
   * TP3 Mission 6 — progression de l'upload :
   * - `reportUploadProgress: true` demande à Angular de remonter les
   *   événements de progression de l'ENVOI émis par le navigateur
   *   (`reportProgress` est déprécié depuis Angular 22 au profit de
   *   `reportUploadProgress` / `reportDownloadProgress`) ;
   * - `observe: 'events'` change ce que l'Observable émet : au lieu d'UNE
   *   seule valeur (le `Track` final), il émet une SUITE d'`HttpEvent`
   *   (`Sent`, plusieurs `UploadProgress`, `ResponseHeader`, puis
   *   `Response` qui contient le `Track` dans `event.body`).
   * Le composant doit donc trier ces événements : voir
   * `shared/utils/upload-state.ts`.
   *
   * Attention : depuis Angular 22, `HttpClient` utilise `fetch` par défaut,
   * et `fetch` ne fournit pas la progression d'un envoi. Il faut donc
   * `withXhr()` dans `provideHttpClient(...)` (voir `main.ts`). Sans lui,
   * Angular lève l'erreur NG02824 « FetchBackend does not support upload
   * progress reporting » au lieu d'envoyer le fichier.
   */
  upload(file: File, title: string): Observable<HttpEvent<Track>> {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);
    return this.http.post<Track>('/api/tracks', body, {
      reportUploadProgress: true,
      observe: 'events',
    });
  }

  /**
   * TP3 Mission 5 — suppression d'une piste : `DELETE /api/tracks/:id`.
   *
   * Réponses possibles (voir `backend/src/app.js`) :
   * - `204 No Content` : métadonnée ET fichier supprimés (pas de corps) ;
   * - `404` : la piste n'existe plus OU appartient à un autre utilisateur
   *   (le backend filtre sur `{ _id, ownerId: req.auth.sub }` et ne
   *   distingue volontairement pas les deux cas, pour ne rien révéler des
   *   pistes des autres) ;
   * - `401` : JWT absent, invalide ou expiré (géré par
   *   `unauthorizedInterceptor`) ;
   * - `500` : métadonnée supprimée mais fichier non supprimé sur le disque.
   *
   * `encodeURIComponent` empêche un identifiant malformé de modifier le
   * chemin de l'URL (ex. un `/` ou un `?` dans l'id).
   */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tracks/${encodeURIComponent(id)}`);
  }

  /**
   * Lecture authentifiée : la requête passe par `HttpClient`, donc par
   * `authInterceptor` qui ajoute `Authorization: Bearer <token>`.
   * La réponse complète est reçue sous forme de `Blob`.
   */
  audio(id: string) {
    return this.http.get(`/api/tracks/${encodeURIComponent(id)}/audio`, {
      responseType: 'blob',
    });
  }
}
