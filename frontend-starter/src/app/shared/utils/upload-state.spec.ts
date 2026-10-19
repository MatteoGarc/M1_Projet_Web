import { HttpEventType, HttpHeaderResponse, HttpResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { Track } from '../models/track.model';
import { uploadStateFromEvent } from './upload-state';

/**
 * Test d'une fonction PURE : aucun TestBed, aucune dépendance Angular à
 * fournir. On donne un événement, on vérifie l'état renvoyé.
 */
describe('uploadStateFromEvent', () => {
  const track: Track = {
    id: 't1',
    title: 'Blues',
    originalName: 'song1.mp3',
    mimeType: 'audio/mpeg',
    size: 200,
    createdAt: '2026-10-05T10:00:00.000Z',
  };

  it('Sent → upload en cours à 0 %', () => {
    expect(uploadStateFromEvent({ type: HttpEventType.Sent })).toEqual({
      status: 'uploading',
      progress: 0,
      loaded: 0,
      total: null,
    });
  });

  it('UploadProgress → pourcentage arrondi = 100 × loaded / total', () => {
    expect(uploadStateFromEvent({ type: HttpEventType.UploadProgress, loaded: 1, total: 3 })).toEqual({
      status: 'uploading',
      progress: 33,
      loaded: 1,
      total: 3,
    });
    expect(uploadStateFromEvent({ type: HttpEventType.UploadProgress, loaded: 3, total: 3 })).toMatchObject({
      progress: 100,
    });
  });

  it('UploadProgress sans total connu → progression indéterminée (null)', () => {
    expect(uploadStateFromEvent({ type: HttpEventType.UploadProgress, loaded: 512 })).toEqual({
      status: 'uploading',
      progress: null,
      loaded: 512,
      total: null,
    });
  });

  it('Response 201 → succès avec la piste créée', () => {
    const event = new HttpResponse<Track>({ status: 201, body: track });
    expect(uploadStateFromEvent(event)).toEqual({ status: 'success', track });
  });

  it('Response sans corps → erreur (contrat non respecté)', () => {
    const event = new HttpResponse<Track>({ status: 201, body: null });
    expect(uploadStateFromEvent(event)).toMatchObject({ status: 'error' });
  });

  it('ResponseHeader → aucun changement d’affichage', () => {
    expect(uploadStateFromEvent(new HttpHeaderResponse({ status: 201 }))).toBeNull();
  });
});
