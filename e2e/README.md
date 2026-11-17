# Tests de bout en bout (Playwright)

Ces tests pilotent un vrai navigateur sur la vraie application : build Angular, backend Express, base MongoDB.
Ils vérifient les parcours complets : inscription et connexion, import, lecture, suppression et pagination des pistes, enregistreur (avec un faux micro), affichage mobile, clavier et erreurs JavaScript.

## Lancer les tests

Depuis la racine du dépôt :

```bash
node e2e/run-e2e.mjs                          # Chromium, Firefox et WebKit (moteur de Safari)
node e2e/run-e2e.mjs --browsers=chromium      # un seul navigateur : plus rapide
node e2e/run-e2e.mjs --keep-report            # garde le rapport HTML (+ journaux) dans e2e/playwright-report
node e2e/run-e2e.mjs -- --grep "connexion"    # tout ce qui suit « -- » est transmis à Playwright
node e2e/run-e2e.mjs --headed                 # voir le navigateur
```

Lancez `node e2e/run-e2e.mjs`, et **pas** `npm test` ni `npx playwright test`. npm écrit un journal dans votre dossier personnel à chaque commande, et `npx playwright` installerait ses navigateurs dans le cache global.

Prérequis : Node.js 20.19 ou plus récent, et un accès Internet (registre npm, téléchargement des navigateurs et de MongoDB).
Il n'est pas nécessaire d'installer MongoDB, Playwright ou les navigateurs.

## Garantie : le PC revient exactement à son état de départ

Le lanceur suit ces étapes :

1. Il **photographie** l'état du PC : tous les fichiers du dépôt (y compris ceux ignorés par git), chaque `node_modules`, les caches globaux de Playwright, de MongoDB et de npm, et la configuration Angular CLI.
2. Il crée **un seul dossier temporaire** et y installe tout : `@playwright/test` et `mongodb-memory-server-core` (avec un cache npm dédié), les navigateurs Playwright et le binaire MongoDB.
   Les processus lancés voient leur dossier personnel (`HOME` / `USERPROFILE`), leurs caches et leurs fichiers temporaires redirigés vers ce dossier.
3. Il lance MongoDB **en mémoire**, le backend (ses fichiers uploadés vont aussi dans le dossier temporaire) et un petit serveur web. Tous utilisent des **ports libres** : pas de conflit avec un `ng serve` ou un backend déjà démarré.
4. Il exécute Playwright.
5. Il **arrête tout et supprime le dossier temporaire**, même après une erreur ou un Ctrl+C. Après un arrêt brutal (coupure de courant, `kill -9`), l'exécution suivante supprime d'abord les restes.
6. Il reprend une photographie et **échoue (code 3)** si quoi que ce soit a changé. Il liste alors les différences.

Ce qu'il ne fait jamais : installation globale (`npm -g`), dépendances système (`playwright install --with-deps`, `sudo`), écriture dans le dépôt (sauf avec `--keep-report`, demandé explicitement) ou dans vos caches.

Si les `node_modules` du frontend ou du backend sont déjà installés, ils sont utilisés **en lecture seule**. Sinon, l'application est copiée dans le dossier temporaire et ses dépendances y sont installées.
Le build Angular est lancé avec `CI=1`, ce qui désactive son cache disque `.angular/`.

## Variables facultatives

| Variable | Effet |
|---|---|
| `MONGOMS_SYSTEM_BINARY=/chemin/vers/mongod` | Utilise un `mongod` déjà installé au lieu de le télécharger. Les données restent en mémoire, dans le dossier temporaire. |
| `E2E_MONGODB_URI=mongodb://…` | Utilise un serveur MongoDB existant. Une base au nom unique `gpc_e2e_…` y est créée puis **supprimée** à la fin ; aucune autre base n'est touchée. |
| `E2E_CHROMIUM_EXECUTABLE=/chemin/vers/chrome` | Utilise un Chrome ou Chromium déjà installé au lieu de télécharger celui de Playwright. Il est utilisé tel quel, jamais modifié. |

## Coût

Chaque exécution retélécharge ce dont elle a besoin, puisque rien n'est conservé : compter environ 500 Mo à 1 Go selon les navigateurs, et 1 à 3 minutes de préparation.
Pour un essai rapide, utilisez `--browsers=chromium`, ou réutilisez un `mongod` / un Chrome déjà installés avec les variables ci-dessus.

## Limites connues

- **WebKit** n'a pas de faux micro : les tests de l'enregistreur y sont ignorés. L'enregistreur reste à vérifier à la main sur un vrai Safari.
- **Linux** : les navigateurs Playwright ont besoin de bibliothèques système. Le lanceur ne les installe jamais, car il faudrait `sudo` et cela laisserait des traces.
  S'il en manque, le message d'erreur de Playwright les liste. Vous pouvez alors les installer vous-même, en connaissance de cause, ou vous limiter à `--browsers=chromium,firefox`.
- **Animations** : les tests tournent avec « animations réduites » (`reducedMotion: 'reduce'`).
  Sans carte graphique (CI, machine virtuelle), le rendu logiciel du fond WebGL animé peut bloquer la page : les dialogues ne se ferment plus et l'audio ne se charge pas.
  Le test « aucune erreur console » garde les animations actives.
- Le **son** n'est pas écouté : les tests vérifient qu'un MP3 est produit, envoyé et décodable, pas qu'il sonne juste.

## Écrire un test

Les tests sont dans `tests/`. Le fichier `tests/fixtures.ts` fournit :

- `account` : un compte neuf par test (les tests tournent en parallèle sur la même base) ;
- `signedInPage` : une page déjà connectée avec ce compte ;
- `uploadTrack()` : ajoute une piste par l'API ;
- `wavFile()` : génère un vrai fichier WAV en mémoire.

Privilégiez les sélecteurs accessibles (`getByRole`, `getByLabel`) : ils testent aussi l'accessibilité.

Pour l'autocomplétion dans l'éditeur, vous pouvez lancer `npm ci` dans `e2e/`. C'est facultatif : le lanceur ne s'en sert pas et installe toujours sa propre copie dans le dossier temporaire.
