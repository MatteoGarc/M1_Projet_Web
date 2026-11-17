# M1_Projet_Web

Guitar Practice Cloud : bibliothèque de backing tracks et enregistreur multipiste dans le navigateur.

- `backend/` : API Express + MongoDB
- `frontend-starter/` : application Angular
- `e2e/` : tests de bout en bout (Playwright)

## Tests

| Type | Commande | Ce qui est testé |
|---|---|---|
| Unitaires et composants (API simulée) | `cd frontend-starter && npm test` | Services, guards, intercepteurs, validateurs, audio (Web Audio simulé), chaque page avec un faux backend (`HttpTestingController`) |
| Bout en bout | `node e2e/run-e2e.mjs` | Parcours complets dans Chromium, Firefox et WebKit, avec le vrai backend et MongoDB |
| Backend | `cd backend && npm test` | Routes et contrat de l'API |

Les tests de bout en bout installent tout ce dont ils ont besoin (navigateurs, MongoDB, bibliothèques) dans un dossier temporaire, le suppriment à la fin, puis vérifient que le PC est revenu exactement à son état initial.
Détails, options et limites : [`e2e/README.md`](e2e/README.md).
