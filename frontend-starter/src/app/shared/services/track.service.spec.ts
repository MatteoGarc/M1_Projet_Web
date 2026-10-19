import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';
import { TrackService } from './track.service';

/**
 * Tests UNITAIRES de `TrackService`.
 *
 * `provideHttpClientTesting()` remplace le vrai backend HTTP d'Angular par
 * un faux : AUCUNE requête ne sort du test (pas de backend Express, pas de
 * MongoDB). `HttpTestingController` permet de :
 * - vérifier qu'une requête a été émise (`expectOne`) avec la bonne URL,
 *   la bonne méthode, les bons paramètres / corps ;
 * - lui répondre avec une réponse SIMULÉE (`flush`) ;
 * - vérifier à la fin qu'aucune requête inattendue n'est restée (`verify`).
 */
describe('TrackService', () => {
  let service: TrackService;
  let http: HttpTestingController;

  const track: Track = {
    id: 'abc123',
    title: 'Blues en La',
    originalName: 'song1.mp3',
    mimeType: 'audio/mpeg',
    size: 1024,
    createdAt: '2026-10-05T10:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    http = TestBed.inject(HttpTestingController);
  });

  // Échoue si le code a émis une requête que le test n'a pas traitée.
  afterEach(() => http.verify());

  it('list() transmet page et limit en paramètres de GET /api/tracks', () => {
    let received: Page<Track> | undefined;
    service.list(2, 5).subscribe((page) => (received = page));

    // On cherche la requête par son URL SANS paramètres…
    const req = http.expectOne((r) => r.url === '/api/tracks');
    // …puis on vérifie méthode et paramètres un par un.
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('5');
    expect(req.request.urlWithParams).toBe('/api/tracks?page=2&limit=5');

    const response: Page<Track> = { items: [track], page: 2, limit: 5, total: 6, pages: 2 };
    req.flush(response);
    expect(received).toEqual(response);
  });

  it('remove() envoie DELETE /api/tracks/:id et se termine sur un 204 sans corps', () => {
    let completed = false;
    service.remove('abc123').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/tracks/abc123');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();

    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });

  it('remove() encode l’identifiant dans l’URL', () => {
    service.remove('a/b?c').subscribe();
    const req = http.expectOne('/api/tracks/a%2Fb%3Fc');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('remove() propage un 404 (piste absente ou appartenant à un autre utilisateur)', () => {
    let status: number | undefined;
    service.remove('zzz').subscribe({ error: (e: { status: number }) => (status = e.status) });

    http
      .expectOne('/api/tracks/zzz')
      .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });
    expect(status).toBe(404);
  });

  it('upload() envoie un multipart audio + title et demande les événements de progression', () => {
    const file = new File(['ID3'], 'song1.mp3', { type: 'audio/mpeg' });
    const types: HttpEventType[] = [];
    service.upload(file, 'Blues en La').subscribe((event) => types.push(event.type));

    const req = http.expectOne('/api/tracks');
    expect(req.request.method).toBe('POST');
    // Options indispensables pour la Mission 6.
    expect(req.request.reportUploadProgress).toBe(true);
    // Le corps est un FormData avec EXACTEMENT les champs attendus par Multer.
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('audio')).toBeInstanceOf(File);
    expect((body.get('audio') as File).name).toBe('song1.mp3');
    expect(body.get('title')).toBe('Blues en La');
    expect([...body.keys()].sort()).toEqual(['audio', 'title']);
    // Aucun Content-Type forcé : le navigateur ajoute le « boundary ».
    expect(req.request.headers.has('Content-Type')).toBe(false);

    // Simulation de la séquence d'événements qu'émettrait le navigateur.
    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    req.flush(track, { status: 201, statusText: 'Created' });

    expect(types).toContain(HttpEventType.UploadProgress);
    expect(types.at(-1)).toBe(HttpEventType.Response);
  });
});
