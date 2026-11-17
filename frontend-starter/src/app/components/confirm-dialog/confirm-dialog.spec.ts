import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogData } from '../../shared/models/confirm-dialog-data.model';
import { ConfirmDialogComponent } from './confirm-dialog';

/**
 * Le dialogue est affiché ici SANS `MatDialog.open()` : on lui fournit
 * directement ses données (`MAT_DIALOG_DATA`) et un faux `MatDialogRef`
 * pour vérifier la valeur renvoyée par chaque bouton.
 */
describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  const dialogRef = { close: vi.fn() };

  function render(data: ConfirmDialogData): void {
    TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    });
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
  }

  const buttons = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];

  beforeEach(() => dialogRef.close.mockReset());

  it('affiche le titre, le message et les libellés fournis', () => {
    render({ title: 'Supprimer ?', message: 'Action irréversible.', confirmLabel: 'Supprimer', cancelLabel: 'Garder' });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Supprimer ?');
    expect(el.textContent).toContain('Action irréversible.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Garder', 'Supprimer']);
  });

  it('libellé d’annulation par défaut : « Annuler »', () => {
    render({ title: 'T', message: 'M', confirmLabel: 'OK' });
    expect(buttons()[0].textContent?.trim()).toBe('Annuler');
  });

  it('« Annuler » ferme avec false, la confirmation avec true', () => {
    render({ title: 'T', message: 'M', confirmLabel: 'Supprimer' });

    buttons()[0].click();
    expect(dialogRef.close).toHaveBeenLastCalledWith(false);

    buttons()[1].click();
    expect(dialogRef.close).toHaveBeenLastCalledWith(true);
  });

  it('le focus initial est sur « Annuler » (une action destructive ne part pas sur Entrée)', () => {
    render({ title: 'T', message: 'M', confirmLabel: 'Supprimer' });
    expect(buttons()[0].hasAttribute('cdkFocusInitial')).toBe(true);
    expect(buttons()[1].classList).toContain('danger');
  });
});
