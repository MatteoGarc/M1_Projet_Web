/**
 * Contrôle « le PC est-il exactement dans le même état qu'au départ ? ».
 *
 * Une photographie (snapshot) est prise AVANT les tests puis APRÈS le
 * nettoyage, et les deux sont comparées :
 *
 * Vérifications BLOQUANTES (une différence fait échouer la commande) :
 * - tous les fichiers du dépôt (hors `.git` et contenu des `node_modules`),
 *   y compris les fichiers ignorés par git (`.angular/`, `dist/`, uploads…) ;
 * - chaque `node_modules` du dépôt : liste des paquets et fichier
 *   `.package-lock.json` que npm réécrit à chaque installation ;
 * - les caches globaux que ces outils utilisent par défaut : navigateurs
 *   Playwright, binaires MongoDB, journaux npm, configuration Angular CLI.
 *
 * Vérifications INDICATIVES (un avertissement, car d'autres logiciels du PC
 * écrivent aussi à ces endroits pendant les tests) : nouvelles entrées dans
 * le dossier personnel, les dossiers de cache/config de l'utilisateur et le
 * dossier temporaire du système.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIPPED_REPO_DIRS = new Set(['.git']);

function statKey(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isDirectory() ? 'dir' : `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

function listNames(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return null;
  }
}

function hashFile(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
  } catch {
    return 'absent';
  }
}

/** Parcourt le dépôt et note, pour chaque fichier, sa taille et sa date. */
function walkRepo(repo, ignored, into) {
  const stack = [repo];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repo, full).split(path.sep).join('/');
      if (ignored.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_REPO_DIRS.has(entry.name)) continue;
        if (entry.name === 'node_modules') {
          // Le contenu n'est pas parcouru (des dizaines de milliers de
          // fichiers) : npm réécrit `.package-lock.json` à CHAQUE installation
          // ou désinstallation, c'est un témoin fiable.
          const names = listNames(full) ?? [];
          into.hard.set(`node_modules:${rel}`, `${hashFile(path.join(full, '.package-lock.json'))}|${names.join(',')}`);
          continue;
        }
        into.hard.set(`repo:${rel}/`, 'dir');
        stack.push(full);
      } else {
        into.hard.set(`repo:${rel}`, statKey(full) ?? 'absent');
      }
    }
  }
}

/** Emplacements par défaut des caches des outils utilisés par les tests. */
function knownCaches(home) {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local');
  const caches = {
    'Navigateurs Playwright (Linux)': path.join(home, '.cache/ms-playwright'),
    'Navigateurs Playwright (macOS)': path.join(home, 'Library/Caches/ms-playwright'),
    'Navigateurs Playwright (Windows)': path.join(localAppData, 'ms-playwright'),
    'Binaires MongoDB (mongodb-memory-server)': path.join(home, '.cache/mongodb-binaries'),
    'Journaux npm': path.join(home, '.npm/_logs'),
    'Journaux npm (Windows)': path.join(localAppData, 'npm-cache/_logs'),
  };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) caches['Navigateurs Playwright (PLAYWRIGHT_BROWSERS_PATH)'] = process.env.PLAYWRIGHT_BROWSERS_PATH;
  return caches;
}

function userDirs(home) {
  const dirs = [home, os.tmpdir()];
  if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library/Caches'), path.join(home, 'Library/Application Support'));
  } else if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(process.env.APPDATA);
    if (process.env.LOCALAPPDATA) dirs.push(process.env.LOCALAPPDATA);
  } else {
    dirs.push(path.join(home, '.cache'), path.join(home, '.config'), path.join(home, '.local/share'));
  }
  return dirs;
}

/**
 * Prend une photographie de l'état du PC.
 * @param {{ repo: string, home: string, ignored?: string[] }} options
 *   `ignored` : chemins du dépôt volontairement exclus (ex. rapport demandé).
 */
export function takeSnapshot({ repo, home, ignored = [] }) {
  const snapshot = { hard: new Map(), soft: new Map() };
  walkRepo(repo, ignored, snapshot);

  for (const [label, dir] of Object.entries(knownCaches(home))) {
    const names = listNames(dir);
    snapshot.hard.set(`cache:${label} (${dir})`, names === null ? 'absent' : names.join(','));
  }
  snapshot.hard.set(`fichier:${path.join(home, '.angular-config.json')}`, statKey(path.join(home, '.angular-config.json')) ?? 'absent');

  for (const dir of userDirs(home)) {
    snapshot.soft.set(dir, new Set(listNames(dir) ?? []));
  }
  return snapshot;
}

/** Compare deux photographies et décrit les différences en français. */
export function compareSnapshots(before, after) {
  const differences = [];
  const keys = new Set([...before.hard.keys(), ...after.hard.keys()]);
  for (const key of [...keys].sort()) {
    const a = before.hard.get(key);
    const b = after.hard.get(key);
    if (a === b) continue;
    if (a === undefined) differences.push(`ajouté    ${key}`);
    else if (b === undefined) differences.push(`supprimé  ${key}`);
    else differences.push(`modifié   ${key}`);
  }

  const warnings = [];
  for (const [dir, names] of before.soft) {
    const now = after.soft.get(dir) ?? new Set();
    for (const name of now) if (!names.has(name)) warnings.push(`nouvelle entrée : ${path.join(dir, name)}`);
    for (const name of names) if (!now.has(name)) warnings.push(`entrée disparue : ${path.join(dir, name)}`);
  }
  return { differences, warnings };
}
