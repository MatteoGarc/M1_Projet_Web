import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
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
        // Le lien « Ouvrir l'enregistreur » (routerLink) a besoin du Router.
        provideRouter([]),
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
  // -------------------------------------------------------------------
  // Mission 2 — chargement, état vide et pagination serveur
  // -------------------------------------------------------------------
  const pageN = (n: number, items: Track[], total: number): Page<Track> => ({
    items,
    page: n,
    limit: 5,
    total,
    pages: Math.max(1, Math.ceil(total / 5)),
  });
  const expectPage = (n: number): TestRequest =>
    http.expectOne((r) => r.url === '/api/tracks' && r.method === 'GET' && r.params.get('page') === String(n));
  const button = (text: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('affiche « Chargement… » pendant la requête et désactive « Actualiser »', () => {
    fixture.detectChanges();
    expect(el().querySelector('.loading')?.textContent).toContain('Chargement…');
    expect(button('Actualiser').disabled).toBe(true);
    expect(el().querySelector('.track-list')?.getAttribute('aria-busy')).toBe('true');
    expectList().flush(page([]));
  });

  it('état vide : message d’invitation à importer', async () => {
    await displayTracks([]);
    expect(el().querySelector('.empty')?.textContent).toContain('Aucune piste pour l’instant.');
    expect(el().querySelector('#tracks-title')?.textContent).toContain('(0)');
  });

  it('pagination : « Suivant » demande la page 2 au serveur, « Précédent » est désactivé en page 1', async () => {
    expectList().flush(pageN(1, tracks, 7));
    fixture.detectChanges();
    expect(el().querySelector('.pager')?.textContent).toContain('Page 1 / 2');
    expect(button('Précédent').disabled).toBe(true);

    button('Suivant').click();
    expectPage(2).flush(pageN(2, [{ ...tracks[0], id: 't6', title: 'Rock en Ré' }], 7));
    fixture.detectChanges();

    expect(el().querySelector('.pager')?.textContent).toContain('Page 2 / 2');
    expect(button('Suivant').disabled).toBe(true);
    expect(el().querySelectorAll('app-track-card')).toHaveLength(1);
    expect(el().textContent).toContain('Rock en Ré');
  });

  it('page devenue vide (pistes supprimées ailleurs) : redemande la dernière page existante', async () => {
    expectList().flush(pageN(1, tracks, 7));
    component.go(2);
    expectPage(2).flush({ items: [], page: 2, limit: 5, total: 3, pages: 1 });

    expectPage(1).flush(pageN(1, tracks, 3));
    expect(component.page()).toBe(1);
    expect(component.tracks()).toEqual(tracks);
  });

  it('« Réessayer » après une erreur relance le chargement', async () => {
    expectList().flush({ message: 'Base indisponible' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    button('Réessayer').click();
    expectList().flush(page(tracks));
    fixture.detectChanges();
    expect(el().querySelectorAll('app-track-card')).toHaveLength(2);
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  // -------------------------------------------------------------------
  // Mission 3 — lecture audio authentifiée (Blob)
  // -------------------------------------------------------------------
  describe('lecture audio', () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();

    beforeEach(() => {
      // jsdom n'implémente pas les ObjectURL.
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
    });

    it('télécharge le Blob puis l’affecte au lecteur', async () => {
      await displayTracks();
      el().querySelector<HTMLButtonElement>('.track-card__play')?.click();
      fixture.detectChanges();
      expect(el().querySelector('.track-card__play')?.textContent).toContain('Chargement');

      const req = http.expectOne('/api/tracks/t1/audio');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['ID3'], { type: 'audio/mpeg' }));
      fixture.detectChanges();

      expect(el().querySelector('audio')?.getAttribute('src')).toBe('blob:fake-url');
      expect(el().querySelector('.player__now')?.textContent).toContain('Blues en La');
      expect(el().querySelector('.track-card__play')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('changer de piste révoque l’ancienne URL (pas de fuite mémoire)', async () => {
      await displayTracks();
      component.play(tracks[0]);
      http.expectOne('/api/tracks/t1/audio').flush(new Blob(['a']));
      component.play(tracks[1]);
      http.expectOne('/api/tracks/t2/audio').flush(new Blob(['b']));

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      expect(component.currentTrack()?.id).toBe('t2');
    });

    it('erreur de lecture : message du serveur affiché', async () => {
      await displayTracks();
      component.play(tracks[1]);
      // Requête `responseType: 'blob'` : le corps d'ERREUR arrive lui aussi en Blob.
      // (jsdom n'implémente pas `Blob.text()`, on l'ajoute comme dans un navigateur.)
      const json = JSON.stringify({ message: 'Piste inconnue' });
      const body = Object.assign(new Blob([json], { type: 'application/json' }), { text: () => Promise.resolve(json) });
      http.expectOne('/api/tracks/t2/audio').flush(body, { status: 404, statusText: 'Not Found' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el().querySelector('[role="alert"]')?.textContent).toContain('Piste inconnue (HTTP 404)');
      expect(el().querySelector('audio')).toBeNull();
    });

    it('supprimer la piste en cours de lecture arrête le lecteur', async () => {
      await displayTracks();
      component.play(tracks[0]);
      http.expectOne('/api/tracks/t1/audio').flush(new Blob(['a']));

      component.remove(tracks[0]);
      http.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectList().flush(page([tracks[1]]));
      fixture.detectChanges();

      expect(component.currentTrack()).toBeNull();
      expect(el().querySelector('audio')).toBeNull();
    });

    it('quitter la page révoque l’URL du lecteur', async () => {
      await displayTracks();
      component.play(tracks[0]);
      http.expectOne('/api/tracks/t1/audio').flush(new Blob(['a']));

      fixture.destroy();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });
  });

  it('upload : le titre vide est remplacé par le nom du fichier', async () => {
    await displayTracks();
    selectFile(new File([new Uint8Array(10)], 'impro.ogg', { type: 'audio/ogg' }));
    component.upload();

    const req = http.expectOne((r) => r.method === 'POST');
    expect((req.request.body as FormData).get('title')).toBe('impro.ogg');
    expect((req.request.body as FormData).get('audio')).toBeInstanceOf(File);
    req.flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
  });
});
