import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTake, Take, TakePatch } from '../../shared/models/take.model';
import { fakeAudioBuffer } from '../../shared/testing/fake-web-audio';
import { TakeEditorComponent } from './take-editor';

/**
 * L'éditeur ne joue aucun son : il traduit chaque geste de l'utilisateur
 * en un `TakePatch` émis par `changed`. On simule les gestes (saisie,
 * curseur, case à cocher) et on vérifie le patch émis.
 */
describe('TakeEditorComponent', () => {
  let fixture: ComponentFixture<TakeEditorComponent>;
  let patches: TakePatch[];
  let removed: number;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const baseTake = (patch: Partial<Take> = {}): Take => ({ ...createTake(fakeAudioBuffer(2), 'Prise 1'), ...patch });

  /** Champ (input/select) contenu dans le <label> dont le texte commence par `text`. */
  function field<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(text: string): T {
    const label = [...el().querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(text));
    const control = label?.querySelector('input, select');
    if (!control) throw new Error(`Champ « ${text} » introuvable`);
    return control as T;
  }

  function set(control: HTMLInputElement | HTMLSelectElement, value: string, event: 'input' | 'change'): void {
    control.value = value;
    control.dispatchEvent(new Event(event));
  }

  function render(take = baseTake(), disabled = false): void {
    fixture.componentRef.setInput('take', take);
    fixture.componentRef.setInput('disabled', disabled);
    fixture.detectChanges();
  }

  beforeEach(() => {
    // jsdom ne dessine pas sur un <canvas> : la forme d'onde est ignorée.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    patches = [];
    removed = 0;
    fixture = TestBed.createComponent(TakeEditorComponent);
    fixture.componentInstance.changed.subscribe((p) => patches.push(p));
    fixture.componentInstance.removed.subscribe(() => removed++);
  });

  afterEach(() => vi.restoreAllMocks());

  it('affiche le nom, la durée jouée et l’état audible', () => {
    render();
    expect(el().querySelector<HTMLInputElement>('.take__name input')?.value).toBe('Prise 1');
    expect(el().querySelector('.take__time')?.textContent).toBe('0:02.0');
    expect(el().querySelector('.take__mute')?.textContent?.trim()).toBe('Audible');
  });

  it('renommer : espaces retirés, nom de secours si vide', () => {
    render();
    const name = el().querySelector<HTMLInputElement>('.take__name input') as HTMLInputElement;
    set(name, '  Basse  ', 'change');
    set(name, '   ', 'change');
    expect(patches).toEqual([{ name: 'Basse' }, { name: 'Prise sans nom' }]);
  });

  it('coupe : la poignée de début ne peut pas dépasser la fin', () => {
    render(baseTake({ trimStart: 0, trimEnd: 1 }));
    const start = field('Début');
    set(start, '1.5', 'input');

    expect(patches).toEqual([{ trimStart: 0.95, trimEnd: 1 }]);
    // Le curseur est remis à la valeur réellement appliquée.
    expect(start.valueAsNumber).toBe(0.95);
  });

  it('coupe : déplacer la fin envoie la nouvelle fin', () => {
    render();
    set(field('Fin'), '1.25', 'input');
    expect(patches).toEqual([{ trimStart: 0, trimEnd: 1.25 }]);
  });

  it('« Tout garder » rétablit la coupe complète', () => {
    render(baseTake({ trimStart: 0.5, trimEnd: 1 }));
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Tout garder'))?.click();
    expect(patches).toEqual([{ trimStart: 0, trimEnd: 2 }]);
  });

  it('boucle : activation puis nombre de répétitions borné entre 2 et 64', () => {
    render();
    const loop = field('Répéter');
    loop.checked = true;
    loop.dispatchEvent(new Event('change'));
    expect(patches).toEqual([{ loop: true }]);

    render(baseTake({ loop: true }));
    const repeats = el().querySelector<HTMLInputElement>('input[type="number"][max="64"]') as HTMLInputElement;
    set(repeats, '100', 'change');
    set(repeats, '1', 'change');
    set(repeats, '3.6', 'change');
    expect(patches.slice(1)).toEqual([{ repeats: 64 }, { repeats: 2 }, { repeats: 4 }]);
  });

  it('départ : borné entre 0 et 600 s', () => {
    render();
    const offset = field('Départ à');
    set(offset, '-3', 'change');
    set(offset, '1.5', 'change');
    expect(patches).toEqual([{ offset: 0 }, { offset: 1.5 }]);
  });

  it('volume : pourcentage converti en gain linéaire', () => {
    render();
    set(field('Volume'), '50', 'input');
    expect(patches).toEqual([{ volume: 0.5 }]);
  });

  it('muet : bascule et bouton pressé', () => {
    render(baseTake({ muted: true }));
    const mute = el().querySelector<HTMLButtonElement>('.take__mute') as HTMLButtonElement;
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    mute.click();
    expect(patches).toEqual([{ muted: false }]);
  });

  it('effets : chaque réglage conserve les autres effets', () => {
    const take = baseTake();
    render(take);
    set(field<HTMLSelectElement>('Filtre'), 'lowpass', 'change');
    set(field('Écho'), '30', 'input');
    set(field('Réverbération'), '20', 'input');
    set(field('Distorsion'), '10', 'input');

    expect(patches).toEqual([
      { effects: { ...take.effects, filter: 'lowpass' } },
      { effects: { ...take.effects, echo: 0.3 } },
      { effects: { ...take.effects, reverb: 0.2 } },
      { effects: { ...take.effects, distortion: 0.1 } },
    ]);
  });

  it('les réglages dépendants n’apparaissent que si l’effet est actif', () => {
    render();
    expect(() => field('Fréquence')).toThrow();
    expect(() => field('Délai de l’écho')).toThrow();

    const take = baseTake();
    render({ ...take, effects: { ...take.effects, filter: 'highpass', echo: 0.5 } });
    set(field('Fréquence'), '2000', 'input');
    set(field('Délai de l’écho'), '250', 'input');
    expect(patches[0]).toEqual({ effects: expect.objectContaining({ filterFrequency: 2000 }) });
    expect(patches[1]).toEqual({ effects: expect.objectContaining({ echoTime: 0.25 }) });
  });

  it('suppression : émet removed, avec un libellé accessible explicite', () => {
    render();
    const remove = el().querySelector<HTMLButtonElement>('.take__delete') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Supprimer la prise Prise 1');
    remove.click();
    expect(removed).toBe(1);
  });

  it('désactivé (enregistrement ou sauvegarde en cours) : tous les contrôles sont bloqués', () => {
    render(baseTake(), true);
    const buttons = [...el().querySelectorAll<HTMLButtonElement>('.take__head button')];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(el().querySelector<HTMLInputElement>('.take__name input')?.disabled).toBe(true);
    const fieldsets = [...el().querySelectorAll('fieldset')];
    expect(fieldsets.length).toBeGreaterThan(0);
    expect(fieldsets.every((f) => f.disabled)).toBe(true);
  });
});
