import { TestBed } from '@angular/core/testing';
import { HttpBackend, HttpXhrBackend } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';

/**
 * Test de non-régression de la CONFIGURATION (bug réel rencontré au TP3).
 *
 * Les autres tests remplacent le backend HTTP par `HttpTestingController` :
 * ils ne peuvent donc pas voir quel backend l'application utilise vraiment.
 * Or, sans `withXhr()`, Angular 22 utilise `fetch`, qui ne signale pas la
 * progression d'un envoi. Ce test charge la vraie configuration et vérifie
 * le backend injecté.
 */
describe('appConfig', () => {
  it('utilise le backend XMLHttpRequest (indispensable à la progression d’upload)', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });

    expect(TestBed.inject(HttpBackend)).toBeInstanceOf(HttpXhrBackend);
  });
});
