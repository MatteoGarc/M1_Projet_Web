/*
 * TP3 Mission 7 — extension backend facultative : tests de CONTRAT et de
 * SÉCURITÉ de l'API, sans modifier aucune route de `src/app.js`.
 *
 * Comment ces tests fonctionnent sans MongoDB ?
 * - `createApp()` construit l'application Express SANS ouvrir de connexion
 *   MongoDB (la connexion est faite dans `server.js`, jamais importé ici).
 * - Les cas 401 / 400 sont rejetés par le middleware `auth` ou par Multer
 *   AVANT tout accès à la base : aucun mock n'est nécessaire.
 * - Pour la pagination et la propriété des pistes, on remplace les méthodes
 *   du modèle Mongoose `Track` (`find`, `countDocuments`, `findOneAndDelete`,
 *   `findOne`, `create`) par de fausses implémentations avec
 *   `t.mock.method(...)` de `node:test`. Elles sont restaurées
 *   automatiquement à la fin de chaque test. On vérifie alors CE QUE la
 *   route demande à MongoDB (filtre, skip, limit…) et ce qu'elle répond.
 *
 * Les JWT utilisés sont signés ici avec le secret de DÉVELOPPEMENT par
 * défaut de `app.js` (ou `JWT_SECRET` s'il est défini dans l'environnement
 * du test). Aucun vrai secret ni vrai token n'est écrit dans ce fichier.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Track } from "../src/models/Track.js";

// Même expression que dans app.js : le test signe ses tokens avec le secret
// que l'application utilisera pour les vérifier.
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
// Même dossier que app.js (chemin relatif au dossier de lancement : backend/).
const UPLOADS = path.resolve("data/uploads");

const ALICE = new mongoose.Types.ObjectId().toString();
const BOB = new mongoose.Types.ObjectId().toString();

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

/** Crée un en-tête Authorization valide pour l'utilisateur `sub`. */
function bearer(sub, options = { expiresIn: "2h" }, secret = SECRET) {
  return { Authorization: `Bearer ${jwt.sign({ sub, email: "test@example.com" }, secret, options)}` };
}

/** Liste les fichiers présents dans le dossier d'upload. */
function uploadedFiles() {
  return fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : [];
}

/**
 * Fausse requête Mongoose « chaînable » : `find().sort().skip().limit()…`
 * Chaque appel est enregistré dans `calls` pour pouvoir le vérifier.
 */
function fakeQuery(result) {
  const calls = {};
  const query = {
    calls,
    sort(value) { calls.sort = value; return query; },
    skip(value) { calls.skip = value; return query; },
    limit(value) { calls.limit = value; return query; },
    select(value) { calls.select = value; return query; },
    lean() { return Promise.resolve(result); },
    // Permet aussi `await Track.findOne(...).select(...)` sans `.lean()`.
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return query;
}

// ===================================================================
// 401 — authentification
// ===================================================================

test("401 sans JWT sur les routes protégées", async () => {
  const routes = [
    ["GET", "/api/users/me"],
    ["GET", "/api/tracks?page=1&limit=5"],
    ["POST", "/api/tracks"],
    ["GET", `/api/tracks/${new mongoose.Types.ObjectId()}/audio`],
    ["DELETE", `/api/tracks/${new mongoose.Types.ObjectId()}`],
  ];

  for (const [method, url] of routes) {
    const response = await fetch(base + url, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
    assert.deepEqual(await response.json(), { message: "Authentification requise" });
  }
});

test("401 si l'en-tête n'utilise pas le schéma Bearer", async () => {
  const token = jwt.sign({ sub: ALICE }, SECRET);
  const response = await fetch(`${base}/api/tracks`, { headers: { Authorization: token } });
  assert.equal(response.status, 401);
});

test("401 avec un JWT invalide (malformé, mauvaise signature, expiré)", async () => {
  const cases = {
    malformé: { Authorization: "Bearer ceci-n-est-pas-un-jwt" },
    "signé avec un autre secret": bearer(ALICE, { expiresIn: "2h" }, "un-autre-secret"),
    expiré: bearer(ALICE, { expiresIn: -10 }),
  };

  for (const [label, headers] of Object.entries(cases)) {
    const response = await fetch(`${base}/api/tracks/${new mongoose.Types.ObjectId()}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(response.status, 401, label);
    assert.deepEqual(await response.json(), { message: "Jeton invalide ou expiré" }, label);
  }
});

// ===================================================================
// 400 — upload
// ===================================================================

test("400 pour un upload sans fichier (champ audio absent)", async (t) => {
  const create = t.mock.method(Track, "create");
  const form = new FormData();
  form.append("title", "Sans fichier");

  const response = await fetch(`${base}/api/tracks`, { method: "POST", headers: bearer(ALICE), body: form });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Fichier audio requis" });
  assert.equal(create.mock.callCount(), 0, "aucune métadonnée ne doit être créée");
});

test("400 pour un type MIME refusé, sans écrire le fichier sur le disque", async (t) => {
  const create = t.mock.method(Track, "create");
  const before = uploadedFiles();
  const form = new FormData();
  form.append("title", "Pas de l'audio");
  form.append("audio", new Blob(["bonjour"], { type: "text/plain" }), "notes.txt");

  const response = await fetch(`${base}/api/tracks`, { method: "POST", headers: bearer(ALICE), body: form });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Format audio non accepté" });
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(uploadedFiles(), before, "fileFilter refuse AVANT l'écriture");
});

test("400 pour un fichier de plus de 25 Mo, fichier partiel supprimé", async (t) => {
  const create = t.mock.method(Track, "create");
  const before = uploadedFiles();
  const form = new FormData();
  form.append("title", "Trop gros");
  form.append("audio", new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: "audio/mpeg" }), "gros.mp3");

  const response = await fetch(`${base}/api/tracks`, { method: "POST", headers: bearer(ALICE), body: form });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "File too large" });
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(uploadedFiles(), before, "Multer supprime le fichier partiellement écrit");
});

test("201 pour un upload valide : champs audio + title, propriétaire = sub du JWT", async (t) => {
  let saved;
  t.mock.method(Track, "create", async (data) => {
    saved = data;
    return { id: "t-new", toPublic: () => ({ id: "t-new", ownerId: data.ownerId, title: data.title }) };
  });
  const form = new FormData();
  form.append("title", "Blues en La");
  form.append("audio", new Blob([crypto.randomBytes(64)], { type: "audio/mpeg" }), "song.mp3");

  try {
    const response = await fetch(`${base}/api/tracks`, { method: "POST", headers: bearer(ALICE), body: form });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: "t-new", ownerId: ALICE, title: "Blues en La" });
    assert.equal(saved.ownerId, ALICE);
    assert.equal(saved.mimeType, "audio/mpeg");
    assert.equal(saved.size, 64);
    assert.match(saved.storedName, /^[0-9a-f-]{36}\.mp3$/, "nom de stockage aléatoire");
  } finally {
    // Nettoyage du fichier réellement écrit par Multer.
    if (saved?.storedName) fs.rmSync(path.join(UPLOADS, saved.storedName), { force: true });
  }
});

// ===================================================================
// Pagination
// ===================================================================

test("pagination : page et limit deviennent skip/limit MongoDB, filtrés par propriétaire", async (t) => {
  const query = fakeQuery([
    { _id: new mongoose.Types.ObjectId(), title: "A", ownerId: ALICE },
    { _id: new mongoose.Types.ObjectId(), title: "B", ownerId: ALICE },
  ]);
  const find = t.mock.method(Track, "find", () => query);
  const count = t.mock.method(Track, "countDocuments", async () => 7);

  const response = await fetch(`${base}/api/tracks?page=2&limit=3`, { headers: bearer(ALICE) });
  const body = await response.json();

  assert.equal(response.status, 200);
  // Ce que la route demande à MongoDB :
  assert.deepEqual(find.mock.calls[0].arguments[0], { ownerId: ALICE });
  assert.deepEqual(count.mock.calls[0].arguments[0], { ownerId: ALICE });
  assert.deepEqual(query.calls.sort, { createdAt: -1 });
  assert.equal(query.calls.skip, 3, "(page - 1) × limit");
  assert.equal(query.calls.limit, 3);
  assert.equal(query.calls.select, "-storedName", "le nom de stockage n'est jamais exposé");
  // Forme Page<Track> du contrat :
  assert.equal(body.page, 2);
  assert.equal(body.limit, 3);
  assert.equal(body.total, 7);
  assert.equal(body.pages, 3);
  assert.equal(body.items.length, 2);
  assert.equal(typeof body.items[0].id, "string");
  assert.equal("_id" in body.items[0], false);
});

test("pagination : valeurs par défaut et limite plafonnée à 20", async (t) => {
  const query = fakeQuery([]);
  t.mock.method(Track, "find", () => query);
  t.mock.method(Track, "countDocuments", async () => 0);

  const response = await fetch(`${base}/api/tracks?page=-4&limit=500`, { headers: bearer(ALICE) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
  assert.equal(body.pages, 1, "au moins une page même vide");
  assert.equal(query.calls.skip, 0);
});

// ===================================================================
// Propriété des pistes (suppression et lecture)
// ===================================================================

/**
 * Simule une base contenant UNE piste appartenant à Alice : la fausse
 * requête ne renvoie la piste que si le filtre contient le bon `_id` ET
 * `ownerId: ALICE` — exactement comme MongoDB le ferait.
 */
function aliceTrackDb(trackId, storedName) {
  return (filter) =>
    fakeQuery(
      filter._id === trackId && filter.ownerId === ALICE
        ? { id: trackId, storedName, mimeType: "audio/mpeg" }
        : null,
    );
}

test("DELETE sur la piste d'un autre utilisateur : 404 et rien n'est supprimé", async (t) => {
  const trackId = new mongoose.Types.ObjectId().toString();
  const storedName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(UPLOADS, storedName);
  fs.writeFileSync(filePath, "audio d'Alice");
  const findOneAndDelete = t.mock.method(Track, "findOneAndDelete", aliceTrackDb(trackId, storedName));

  try {
    const response = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer(BOB) });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { message: "Piste inconnue" });
    // La requête MongoDB contient bien le propriétaire issu du JWT de Bob :
    assert.deepEqual(findOneAndDelete.mock.calls[0].arguments[0], { _id: trackId, ownerId: BOB });
    assert.equal(fs.existsSync(filePath), true, "le fichier d'Alice est intact");
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("DELETE par la propriétaire : 204 sans corps et fichier supprimé du disque", async (t) => {
  const trackId = new mongoose.Types.ObjectId().toString();
  const storedName = `${crypto.randomUUID()}.mp3`;
  const filePath = path.join(UPLOADS, storedName);
  fs.writeFileSync(filePath, "audio d'Alice");
  t.mock.method(Track, "findOneAndDelete", aliceTrackDb(trackId, storedName));

  try {
    const response = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer(ALICE) });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("DELETE d'une piste déjà supprimée : 404 (second appel)", async (t) => {
  const trackId = new mongoose.Types.ObjectId().toString();
  // Base vide : la piste a été supprimée entre-temps (autre onglet).
  t.mock.method(Track, "findOneAndDelete", () => fakeQuery(null));

  const response = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer(ALICE) });

  assert.equal(response.status, 404);
});

test("lecture audio de la piste d'un autre utilisateur : 404", async (t) => {
  const trackId = new mongoose.Types.ObjectId().toString();
  const findOne = t.mock.method(Track, "findOne", aliceTrackDb(trackId, "inutile.mp3"));

  const response = await fetch(`${base}/api/tracks/${trackId}/audio`, { headers: bearer(BOB) });

  assert.equal(response.status, 404);
  assert.deepEqual(findOne.mock.calls[0].arguments[0], { _id: trackId, ownerId: BOB });
});
