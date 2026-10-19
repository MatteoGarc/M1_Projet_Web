import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { unsavedChangesGuard } from './shared/guards/unsaved-changes.guard';
import { LoginPageComponent } from './components/login-page/login-page';
import { ProfilePageComponent } from './components/profile-page/profile-page';
import { RegisterPageComponent } from './components/register-page/register-page';
import { TracksPageComponent } from './components/tracks-page/tracks-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tracks' },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'profile', component: ProfilePageComponent, canActivate: [authGuard] },
  { path: 'tracks', component: TracksPageComponent, canActivate: [authGuard] },
  {
    // Chargée à la demande : l'encodeur MP3 n'est téléchargé que si on ouvre l'enregistreur.
    path: 'record',
    loadComponent: () => import('./components/recorder-page/recorder-page').then((m) => m.RecorderPageComponent),
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
  },
  { path: '**', redirectTo: 'tracks' },
];
