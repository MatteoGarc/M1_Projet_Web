import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../shared/models/page.model';
import { Track } from '../../shared/models/track.model';
import { NotificationService } from '../../shared/services/notification.service';
import { TracksPageComponent } from './tracks-page';

/**
 * Tests du composant `TracksPageComponent` (TP3 Missions 5 et 6).
 *
 * Ce sont des tests de composant « isolé » :
 * - le VRAI `TrackService` est utilisé, mais `HttpClient` parle à un faux
 *   backend (`HttpTestingController`) : on vérifie donc les vraies URL et
 *   méthodes émises, sans serveur Express ni MongoDB ;
 * - `MatDialog` est remplacé par un faux qui « répond » oui ou non à la
 *   place de l'utilisateur ;
 * - `NotificationService` (SnackBar) est remplacé par des espions `vi.fn()`.
 */
describe('TracksPageComponent', () => {
  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let http: HttpTestingController;
  /** Réponse que le faux dialogue renverra (`true` = confirmer). */
  let dialogAnswer: boolean | undefined;
  const dialog = { open: vi.fn() };
  const notifications = { success: vi.fn(), error: vi.fn() };

  const tracks: Track[] = [
    { id: 't1', title: 'Blues en La', originalName: 'song1.mp3', mimeType: 'audio/mpeg', size: 2048, createdAt: '2026-10-05T10:00:00.000Z' },
    { id: 't2', title: 'Funk en Mi', originalName: 'song2.mp3', mimeType: 'audio/mpeg', size: 4096, createdAt: '2026-10-04T10:00:00.000Z' },
  ];

  const page = (items: Track[], total = items.length): Page<Track> => ({
    items,
    page: 1,
    limit: 5,
    total,
    pages: Math.max(1, Math.ceil(total / 5)),
  });

  /** Récupère la requête de liste et vérifie qu'elle demande bien la page 1. */
  const expectList = (): TestRequest => {
    const req = http.expectOne((r) => r.url === '/api/tracks' && r.method === 'GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('5');
    return req;
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const deleteButtons = () => [...el().querySelectorAll<HTMLButtonElement>('.track-card__delete')];

  beforeEach(async () => {
    dialogAnswer = true;
    dialog.open.mockReset();
    dialog.open.mockImplementation(() => ({ afterClosed: (): Observable<boolean | undefined> => of(dialogAnswer) }));
    notifications.success.mockReset();
    notifications.error.mockReset();

    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
      ],
    });

    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Le constructeur appelle `load()` : on répond à cette première requête. */
  async function displayTracks(items = tracks): Promise<void> {
    expectList().flush(page(items));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  // -------------------------------------------------------------------
  // Affichage d'une erreur HTTP
  // -------------------------------------------------------------------
  it('affiche le message du serveur après un échec HTTP du chargement', async () => {
    expectList().flush({ message: 'Base indisponible' }, { status: 500, statusText: 'Server Error' });
    // httpErrorMessage est asynchrone (lecture possible d'un Blob) : on attend.
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = el().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Base indisponible (HTTP 500)');
    expect(el().querySelectorAll('app-track-card').length).toBe(0);
  });

  // -------------------------------------------------------------------
  // Mission 5 — suppression
  // -------------------------------------------------------------------
  it('suppression confirmée : DELETE /api/tracks/:id, SnackBar de succès puis rechargement', async () => {
    await displayTracks();
    expect(deleteButtons().length).toBe(2);

    deleteButtons()[0].click();

    // 1. La confirmation est demandée AVANT tout appel HTTP.
    expect(dialog.open).toHaveBeenCalledTimes(1);
    // 2. Puis la requête DELETE part avec la bonne URL.
    const del = http.expectOne('/api/tracks/t1');
    expect(del.request.method).toBe('DELETE');

    // 3. Pendant la requête, le bouton est désactivé (anti double clic).
    fixture.detectChanges();
    expect(deleteButtons()[0].disabled).toBe(true);
    expect(component.isDeleting('t1')).toBe(true);

    del.flush(null, { status: 204, statusText: 'No Content' });

    // 4. Succès signalé et liste rechargée depuis le serveur.
    expect(notifications.success).toHaveBeenCalledWith('« Blues en La » a été supprimée.');
    expect(component.isDeleting('t1')).toBe(false);
    expectList().flush(page([tracks[1]]));
    fixture.detectChanges();
    expect(el().querySelectorAll('app-track-card').length).toBe(1);
    expect(component.total()).toBe(1);
  });

  it('un second clic pendant la suppression n’envoie pas une seconde requête', async () => {
    await displayTracks();

    component.remove(tracks[0]);
    component.remove(tracks[0]);
    component.confirmRemove(tracks[0]);

    // expectOne échoue s'il y a 0 OU 2 requêtes DELETE.
    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(dialog.open).not.toHaveBeenCalled();
    del.flush(null, { status: 204, statusText: 'No Content' });
    expectList().flush(page([tracks[1]]));
  });

  it('suppression annulée : aucune requête DELETE', async () => {
    await displayTracks();
    dialogAnswer = false;

    deleteButtons()[0].click();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    http.expectNone((r) => r.method === 'DELETE');
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it('piste déjà supprimée ailleurs (404) : SnackBar d’erreur et liste resynchronisée', async () => {
    await displayTracks();

    deleteButtons()[1].click();
    http
      .expectOne('/api/tracks/t2')
      .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

    expect(notifications.error).toHaveBeenCalledWith(
      '« Funk en Mi » n’existe plus ou ne vous appartient pas. La liste a été actualisée.',
    );
    expect(notifications.success).not.toHaveBeenCalled();
    // La liste est rechargée pour retirer la piste « fantôme ».
    expectList().flush(page([tracks[0]]));
  });

  it('erreur serveur (500) : SnackBar d’erreur, liste inchangée', async () => {
    await displayTracks();

    component.remove(tracks[0]);
    http
      .expectOne('/api/tracks/t1')
      .flush({ message: 'Métadonnée supprimée, mais fichier audio non supprimé' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(notifications.error).toHaveBeenCalledWith(
      'Métadonnée supprimée, mais fichier audio non supprimé (HTTP 500)',
    );
    http.expectNone((r) => r.url === '/api/tracks' && r.method === 'GET');
    expect(component.isDeleting('t1')).toBe(false);
  });

  // -------------------------------------------------------------------
  // Mission 6 — progression de l'upload
  // -------------------------------------------------------------------
  function selectFile(file: File): void {
    component.choose({ target: { files: [file] } } as unknown as Event);
  }

  it('upload : états uploading (avec %) puis success, contrôles désactivés pendant l’envoi', async () => {
    await displayTracks();
    expect(component.uploadState()).toEqual({ status: 'idle' });

    const file = new File([new Uint8Array(1000)], 'song1.mp3', { type: 'audio/mpeg' });
    selectFile(file);
    component.title.setValue('Nouvelle piste');
    component.upload();

    const req = http.expectOne((r) => r.url === '/api/tracks' && r.method === 'POST');
    expect(req.request.reportUploadProgress).toBe(true);

    // Événement de progression simulé : 40 % envoyés.
    req.event({ type: HttpEventType.UploadProgress, loaded: 400, total: 1000 });
    fixture.detectChanges();

    expect(component.uploadState()).toEqual({ status: 'uploading', progress: 40, loaded: 400, total: 1000 });
    expect(el().querySelector('.upload-progress__label')?.textContent).toContain('40 %');
    expect(el().querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    // Contrôles désactivés : impossible de soumettre une seconde fois.
    expect(el().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(el().querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect(component.title.disabled).toBe(true);
    component.upload();
    // expectOne a déjà « consommé » la première requête : aucune autre ne doit exister.
    http.expectNone((r) => r.method === 'POST');

    // 100 % : octets envoyés mais le serveur n'a pas encore répondu.
    req.event({ type: HttpEventType.UploadProgress, loaded: 1000, total: 1000 });
    fixture.detectChanges();
    expect(el().querySelector('.upload-progress__label')?.textContent).toContain('enregistrement par le serveur');

    const created: Track = { ...tracks[0], id: 't9', title: 'Nouvelle piste' };
    req.flush(created, { status: 201, statusText: 'Created' });
    fixture.detectChanges();

    expect(component.uploadState()).toEqual({ status: 'success', track: created });
    expect(el().querySelector('[role="status"]')?.textContent).toContain('« Nouvelle piste » a bien été ajoutée');
    expect(component.title.enabled).toBe(true);
    expect(component.title.value).toBe('');
    // Retour en page 1 avec la nouvelle piste.
    expectList().flush(page([created, ...tracks]));
  });

  it('upload : une erreur serveur passe à l’état error et permet de réessayer', async () => {
    await displayTracks();
    selectFile(new File([new Uint8Array(10)], 'song1.mp3', { type: 'audio/mpeg' }));

    component.upload();
    http
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'Format audio non accepté' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.uploadState()).toEqual({ status: 'error', message: 'Format audio non accepté (HTTP 400)' });
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Format audio non accepté (HTTP 400)');
    expect(component.uploading()).toBe(false);
    expect(component.title.enabled).toBe(true);
    // Le fichier est toujours sélectionné : le bouton est réactivé.
    expect(el().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('upload : un fichier invalide est refusé AVANT tout appel HTTP', async () => {
    await displayTracks();
    selectFile(new File(['texte'], 'notes.txt', { type: 'text/plain' }));

    component.upload();

    http.expectNone((r) => r.method === 'POST');
    expect(component.fileError()).toContain('Format non accepté');
    expect(component.uploadState()).toEqual({ status: 'idle' });
  });
});
