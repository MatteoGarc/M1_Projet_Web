import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Track } from '../../shared/models/track.model';
import { TrackCardComponent } from './track-card';

/**
 * Composant de présentation pur : on fixe ses `input()` avec
 * `componentRef.setInput()` et on écoute ses `output()`.
 */
describe('TrackCardComponent', () => {
  let fixture: ComponentFixture<TrackCardComponent>;
  const track: Track = {
    id: 't1',
    title: 'Blues en La',
    originalName: 'blues-la.wav',
    mimeType: 'audio/x-wav',
    size: 3_456_789,
    createdAt: '2026-10-05T10:30:00.000Z',
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const playButton = () => el().querySelector<HTMLButtonElement>('.track-card__play') as HTMLButtonElement;
  const deleteButton = () => el().querySelector<HTMLButtonElement>('.track-card__delete') as HTMLButtonElement;

  function render(inputs: Partial<Record<'playing' | 'loadingAudio' | 'deleting', boolean>> = {}, value = track): void {
    fixture.componentRef.setInput('track', value);
    for (const [name, inputValue] of Object.entries(inputs)) fixture.componentRef.setInput(name, inputValue);
    fixture.detectChanges();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(TrackCardComponent);
  });

  it('affiche titre, nom de fichier, format lisible et taille', () => {
    render();
    expect(el().querySelector('h3')?.textContent).toBe('Blues en La');
    expect(el().querySelector('.track-card__file')?.textContent).toBe('blues-la.wav');
    expect(el().textContent).toContain('WAV');
    expect(el().textContent).toContain('3,3 Mo');
    expect(el().querySelector('time')?.getAttribute('datetime')).toBe(track.createdAt);
  });

  it('un type MIME inconnu est affiché tel quel', () => {
    render({}, { ...track, mimeType: 'audio/flac' });
    expect(el().textContent).toContain('audio/flac');
  });

  it('l’article est nommé par son titre (accessibilité)', () => {
    render();
    const article = el().querySelector('article');
    expect(article?.getAttribute('aria-labelledby')).toBe('track-title-t1');
    expect(el().querySelector('#track-title-t1')).not.toBeNull();
  });

  it('émet play et remove avec la piste', () => {
    render();
    const played: Track[] = [];
    const removed: Track[] = [];
    fixture.componentInstance.play.subscribe((t) => played.push(t));
    fixture.componentInstance.remove.subscribe((t) => removed.push(t));

    playButton().click();
    deleteButton().click();

    expect(played).toEqual([track]);
    expect(removed).toEqual([track]);
  });

  it('état « en lecture » : bouton pressé et libellé adapté', () => {
    render({ playing: true });
    expect(playButton().getAttribute('aria-pressed')).toBe('true');
    expect(playButton().getAttribute('aria-label')).toBe('En lecture : Blues en La');
    expect(el().querySelector('article')?.classList).toContain('is-playing');
  });

  it('chargement de l’audio : lecture désactivée', () => {
    render({ loadingAudio: true });
    expect(playButton().disabled).toBe(true);
    expect(playButton().textContent).toContain('Chargement');
    expect(deleteButton().disabled).toBe(false);
  });

  it('suppression en cours : les deux boutons sont désactivés (anti double clic)', () => {
    render({ deleting: true });
    expect(playButton().disabled).toBe(true);
    expect(deleteButton().disabled).toBe(true);
    expect(deleteButton().getAttribute('aria-busy')).toBe('true');
    expect(deleteButton().getAttribute('aria-label')).toBe('Suppression en cours de Blues en La');
  });
});
