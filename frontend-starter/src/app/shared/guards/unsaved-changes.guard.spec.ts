import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRouteSnapshot, RouterStateSnapshot, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, isObservable, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog';
import { AuthService } from '../services/auth.service';
import { HasUnsavedChanges, unsavedChangesGuard } from './unsaved-changes.guard';

/**
 * `unsavedChangesGuard` protège l'enregistreur : les prises ne vivent qu'en
 * mémoire, quitter la page sans sauvegarder les perdrait.
 *
 * `MatDialog` est remplacé par un faux qui répond à la place de
 * l'utilisateur (`true` = « Quitter », `false` = « Rester », `undefined` =
 * Échap / clic à l'extérieur).
 */
describe('unsavedChangesGuard', () => {
  let auth: AuthService;
  let dialogAnswer: boolean | undefined;
  const dialog = { open: vi.fn() };

  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/record' } as RouterStateSnapshot;
  const page = (unsaved: boolean): HasUnsavedChanges => ({ hasUnsavedChanges: () => unsaved });

  beforeEach(() => {
    localStorage.clear();
    dialog.open.mockReset();
    dialog.open.mockImplementation(() => ({ afterClosed: (): Observable<boolean | undefined> => of(dialogAnswer) }));

    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), { provide: MatDialog, useValue: dialog }],
    });
    auth = TestBed.inject(AuthService);
    auth.token.set('fake-token-for-tests');
  });

  const run = (component: HasUnsavedChanges) =>
    TestBed.runInInjectionContext(() => unsavedChangesGuard(component, route, state, { url: '/tracks' } as RouterStateSnapshot));

  async function resolve(result: ReturnType<typeof run>): Promise<unknown> {
    return isObservable(result) ? firstValueFrom(result) : result;
  }

  it('laisse partir sans question quand tout est sauvegardé', async () => {
    expect(await resolve(run(page(false)))).toBe(true);
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('laisse partir sans question quand la session est terminée (pas de token)', async () => {
    auth.token.set(null);
    expect(await resolve(run(page(true)))).toBe(true);
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('demande confirmation avec un texte explicite quand des prises ne sont pas sauvegardées', async () => {
    dialogAnswer = true;
    expect(await resolve(run(page(true)))).toBe(true);

    expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, {
      data: {
        title: 'Quitter sans sauvegarder ?',
        message: 'Vos prises ne sont pas sauvegardées et seront perdues.',
        confirmLabel: 'Quitter',
        cancelLabel: 'Rester',
      },
      restoreFocus: true,
    });
  });

  it('reste sur la page si l’utilisateur choisit « Rester »', async () => {
    dialogAnswer = false;
    expect(await resolve(run(page(true)))).toBe(false);
  });

  it('reste sur la page si la boîte est fermée avec Échap (undefined)', async () => {
    dialogAnswer = undefined;
    expect(await resolve(run(page(true)))).toBe(false);
  });
});
