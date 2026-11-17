import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTake, Take } from '../../shared/models/take.model';
import { Track } from '../../shared/models/track.model';
import { AudioInput, AudioInputService } from '../../shared/services/audio-input.service';
import { NotificationService } from '../../shared/services/notification.service';
import { FakeAudioContext, FakeOfflineAudioContext, fakeAudioBuffer } from '../../shared/testing/fake-web-audio';
import { FakeMediaRecorder } from '../../shared/testing/fake-media-recorder';
import { RecorderPageComponent } from './recorder-page';

/**
 * Page « Enregistrer un MP3 » avec l'API SIMULÉE.
 *
 * Tout ce que jsdom ne sait pas faire est remplacé par des faux :
 * - le micro (`AudioInputService`) ;
 * - `MediaRecorder`, `AudioContext` et `OfflineAudioContext` (Web Audio) ;
 * - le réseau (`HttpTestingController`), la boîte de dialogue et la SnackBar.
 * L'encodeur MP3 (`lamejs`) et `TrackService` sont les vrais : le test
 * vérifie donc le fichier réellement envoyé à `POST /api/tracks`.
 */
describe('RecorderPageComponent (API simulée)', () => {
  let fixture: ComponentFixture<RecorderPageComponent>;
  let component: RecorderPageComponent;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;
  let dialogAnswer: boolean | undefined;
  let micTrack: { stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings };
  let stream: MediaStream;
  let supported: boolean;
  let restoreArrayBuffer: () => void;

  const inputs = signal<AudioInput[]>([]);
  const audioInputs = {
    inputs,
    isSupported: () => supported,
    open: vi.fn(),
  };
  const dialog = { open: vi.fn() };
  const notifications = { success: vi.fn(), error: vi.fn() };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  const alerts = () => [...el().querySelectorAll('[role="alert"]')].map((a) => a.textContent?.trim());
  const saveButton = () => el().querySelector<HTMLButtonElement>('form button[type="submit"]') as HTMLButtonElement;
  const take = (patch: Partial<Take> = {}): Take => ({ ...createTake(fakeAudioBuffer(0.2), 'Prise 1'), ...patch });

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function create(): void {
    fixture = TestBed.createComponent(RecorderPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Attend que l'encodage MP3 (découpé en tranches `setTimeout`) envoie la requête. */
  async function expectUpload(): Promise<TestRequest> {
    return vi.waitFor(() => http.expectOne((r) => r.url === '/api/tracks' && r.method === 'POST'), { timeout: 5000 });
  }

  beforeEach(() => {
    supported = true;
    dialogAnswer = true;
    inputs.set([]);
    micTrack = { stop: vi.fn(), getSettings: () => ({ deviceId: 'usb' }) };
    stream = { getAudioTracks: () => [micTrack], getTracks: () => [micTrack] } as unknown as MediaStream;
    audioInputs.open.mockReset().mockImplementation(async () => {
      inputs.set([
        { deviceId: 'default', label: 'Micro intégré' },
        { deviceId: 'usb', label: 'Interface guitare USB' },
      ]);
      return stream;
    });
    dialog.open.mockReset().mockImplementation(() => ({ afterClosed: (): Observable<boolean | undefined> => of(dialogAnswer) }));
    notifications.success.mockReset();
    notifications.error.mockReset();

    FakeMediaRecorder.reset();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    for (const level of ['debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);

    // Le Blob de jsdom n'a pas `arrayBuffer()` (les navigateurs, si).
    const original = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: Blob) {
        return Promise.resolve(new ArrayBuffer(this.size));
      },
    });
    restoreArrayBuffer = () =>
      original ? Object.defineProperty(Blob.prototype, 'arrayBuffer', original) : delete (Blob.prototype as Partial<Blob>).arrayBuffer;

    TestBed.configureTestingModule({
      imports: [RecorderPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AudioInputService, useValue: audioInputs },
        { provide: MatDialog, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
    restoreArrayBuffer();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------ Navigateur
  it('navigateur sans enregistrement audio : message explicite, aucun contrôle', () => {
    supported = false;
    create();
    expect(alerts()[0]).toContain('Votre navigateur ne permet pas d’enregistrer du son');
    expect(button('Autoriser le micro')).toBeUndefined();
  });

  // ---------------------------------------------------------- Entrée audio
  it('autorisation du micro : liste des entrées, entrée réellement ouverte sélectionnée, vumètre', async () => {
    create();
    expect(button('Enregistrer')?.disabled).toBe(true);

    button('Autoriser le micro')?.click();
    await settle();

    expect(audioInputs.open).toHaveBeenCalledWith(null, false);
    const options = [...el().querySelectorAll('option')];
    expect(options.map((o) => o.textContent)).toEqual(['Micro intégré', 'Interface guitare USB']);
    expect(component.selectedInput()).toBe('usb');
    expect(el().querySelector('[role="meter"]')).not.toBeNull();
    expect(button('Enregistrer')?.disabled).toBe(false);
  });

  it('micro refusé : message d’aide affiché', async () => {
    audioInputs.open.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    create();

    button('Autoriser le micro')?.click();
    await settle();

    expect(alerts()).toContainEqual(expect.stringContaining('Accès au micro refusé'));
    expect(button('Enregistrer')?.disabled).toBe(true);
  });

  // -------------------------------------------------------- Enregistrement
  it('enregistrer, mettre en pause, reprendre puis arrêter : une prise apparaît', async () => {
    create();
    await component.enableInput();
    fixture.detectChanges();

    button('Enregistrer')?.click();
    fixture.detectChanges();
    expect(FakeMediaRecorder.last().state).toBe('recording');
    expect(el().querySelector('.rec-display__status')?.textContent?.trim()).toBe('Enregistrement…');

    button('Pause')?.click();
    fixture.detectChanges();
    expect(el().querySelector('.rec-display__status')?.textContent?.trim()).toBe('En pause');

    button('Reprendre')?.click();
    fixture.detectChanges();
    await component.stopRecording();
    fixture.detectChanges();

    expect(component.takes()).toHaveLength(1);
    expect(el().querySelector<HTMLInputElement>('.take__name input')?.value).toBe('Prise 1');
    expect(el().querySelector('#takes-title')?.textContent).toContain('(1)');
    expect(component.hasUnsavedChanges()).toBe(true);
  });

  it('prise vide : erreur affichée, aucune prise ajoutée', async () => {
    create();
    await component.enableInput();
    component.startRecording();
    FakeMediaRecorder.last().pending = [];

    await component.stopRecording();
    fixture.detectChanges();

    expect(component.takes()).toHaveLength(0);
    expect(alerts()).toContainEqual('L’enregistrement est vide.');
  });

  // ------------------------------------------------------------- Prises
  it('supprimer une prise demande confirmation', async () => {
    create();
    component.takes.set([take(), take({ name: 'Prise 2' })]);
    fixture.detectChanges();

    dialogAnswer = false;
    el().querySelector<HTMLButtonElement>('.take__delete')?.click();
    expect(component.takes()).toHaveLength(2);

    dialogAnswer = true;
    el().querySelector<HTMLButtonElement>('.take__delete')?.click();
    expect(component.takes().map((t) => t.name)).toEqual(['Prise 2']);
    expect(dialog.open.mock.calls[0][1]).toMatchObject({ data: { title: 'Supprimer cette prise ?' } });
  });

  it('modifier une prise la marque comme non sauvegardée', () => {
    create();
    const t = take();
    component.takes.set([t]);
    component.updateTake(t.id, { volume: 0.5 });
    expect(component.takes()[0].volume).toBe(0.5);
    expect(component.hasUnsavedChanges()).toBe(true);
  });

  // ------------------------------------------------------------ Sauvegarde
  it('sans prise : sauvegarde impossible, aucune requête', async () => {
    create();
    expect(saveButton().disabled).toBe(true);
    expect(component.hasUnsavedChanges()).toBe(false);

    await component.save();
    fixture.detectChanges();

    expect(alerts()).toContainEqual('Aucune prise audible à sauvegarder.');
    http.expectNone('/api/tracks');
  });

  it('morceau trop long (> 25 Mo en MP3) : bouton désactivé et avertissement', () => {
    create();
    component.takes.set([take({ offset: 1100 })]);
    fixture.detectChanges();

    expect(saveButton().disabled).toBe(true);
    expect(el().querySelector('.danger-text')?.textContent).toContain('trop long');
  });

  it('succès : mélange → MP3 → POST /api/tracks (FormData), SnackBar puis retour à la bibliothèque', async () => {
    create();
    component.takes.set([take(), take({ name: 'Prise 2', offset: 0.1 })]);
    fixture.detectChanges();
    component.title.setValue('Ma démo à 2 voix');

    saveButton().click();
    const req = await expectUpload();

    // Pendant l'envoi, les contrôles sont bloqués.
    expect(component.saveState().status).toBe('uploading');
    expect(component.title.disabled).toBe(true);
    expect(req.request.reportUploadProgress).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('title')).toBe('Ma démo à 2 voix');
    const file = body.get('audio') as File;
    expect(file.name).toBe('Ma-demo-a-2-voix.mp3');
    expect(file.type).toBe('audio/mpeg');
    expect(file.size).toBeGreaterThan(0);
    // Le mélange a été rendu en stéréo 44,1 kHz sur 0,3 s (offset 0,1 + 0,2 s).
    expect(FakeOfflineAudioContext.last?.length).toBeCloseTo(0.3 * 44_100, -1);

    const created: Track = {
      id: 'r1',
      title: 'Ma démo à 2 voix',
      originalName: file.name,
      mimeType: 'audio/mpeg',
      size: file.size,
      createdAt: '2026-11-17T16:00:00.000Z',
    };
    req.flush(created, { status: 201, statusText: 'Created' });

    expect(notifications.success).toHaveBeenCalledWith('« Ma démo à 2 voix » a été ajoutée à votre bibliothèque.');
    expect(navigate).toHaveBeenCalledWith('/tracks');
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('titre vide : titre daté par défaut', async () => {
    create();
    component.takes.set([take()]);
    await component.save();
    const req = await expectUpload();
    expect((req.request.body as FormData).get('title')).toMatch(/^Enregistrement du \d{2}\/\d{2}\/\d{4}/);
    req.flush(null, { status: 500, statusText: 'Server Error' });
  });

  it('erreur serveur : message affiché, titre réactivé, travail toujours non sauvegardé', async () => {
    create();
    component.takes.set([take()]);
    fixture.detectChanges();

    saveButton().click();
    (await expectUpload()).flush({ message: 'Fichier trop volumineux' }, { status: 413, statusText: 'Payload Too Large' });
    await vi.waitFor(() => expect(component.saveState().status).toBe('error'));
    fixture.detectChanges();

    expect(alerts()).toContainEqual('Fichier trop volumineux (HTTP 413)');
    expect(component.title.enabled).toBe(true);
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  // ------------------------------------------- Travail non sauvegardé
  it('fermeture de l’onglet : le navigateur demande confirmation seulement s’il y a du travail', () => {
    create();
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.onBeforeUnload(event);
    expect(event.defaultPrevented).toBe(false);

    component.takes.set([take()]);
    const second = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.onBeforeUnload(second);
    expect(second.defaultPrevented).toBe(true);
  });

  it('quitter la page coupe le micro et arrête l’enregistrement en cours', async () => {
    create();
    await component.enableInput();
    component.startRecording();
    const media = FakeMediaRecorder.last();

    fixture.destroy();

    expect(micTrack.stop).toHaveBeenCalled();
    expect(media.state).toBe('inactive');
  });
});
