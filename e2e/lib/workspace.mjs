/**
 * Espace de travail JETABLE des tests E2E.
 *
 * Tout ce que les tests téléchargent ou écrivent (navigateurs Playwright,
 * binaire MongoDB, base de données, bibliothèques npm, cache npm, fichiers
 * uploadés, profils de navigateur, fichiers temporaires, rapport…) est
 * placé dans UN SEUL dossier temporaire, supprimé à la fin.
 *
 * Pour qu'aucun outil ne puisse écrire ailleurs « par habitude », les
 * processus lancés reçoivent un environnement dont le dossier personnel
 * (HOME / USERPROFILE), les dossiers de cache et le dossier temporaire
 * pointent vers cet espace.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORKSPACE_PREFIX = 'gpc-e2e-';
const OWNER_FILE = 'owner.json';

/** Vrai si le processus `pid` existe encore. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM : le processus existe mais appartient à un autre utilisateur.
    return error.code === 'EPERM';
  }
}

/** Supprime un dossier, en réessayant (Windows libère les fichiers avec retard). */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

/**
 * Supprime les espaces laissés par une exécution interrompue brutalement
 * (coupure de courant, `kill -9`…) : leur processus propriétaire n'existe plus.
 * @returns la liste des dossiers supprimés.
 */
export function removeStaleWorkspaces(tmpRoot = os.tmpdir()) {
  const removed = [];
  let names = [];
  try {
    names = fs.readdirSync(tmpRoot);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(WORKSPACE_PREFIX)) continue;
    const dir = path.join(tmpRoot, name);
    let pid = null;
    try {
      pid = JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8')).pid;
    } catch {
      // Pas de fichier propriétaire : dossier incomplet, donc abandonné.
    }
    if (pid !== null && isAlive(pid)) continue;
    removeDir(dir);
    removed.push(dir);
  }
  return removed;
}

/** Crée l'espace de travail et ses sous-dossiers. */
export function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  fs.writeFileSync(path.join(root, OWNER_FILE), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  const dirs = {
    root,
    home: path.join(root, 'home'),
    tmp: path.join(root, 'tmp'),
    npmCache: path.join(root, 'npm-cache'),
    npmLogs: path.join(root, 'npm-logs'),
    browsers: path.join(root, 'browsers'),
    mongoBinaries: path.join(root, 'mongo-binaries'),
    mongoData: path.join(root, 'mongo-data'),
    backendCwd: path.join(root, 'backend-cwd'),
    deps: path.join(root, 'deps'),
    dist: path.join(root, 'dist'),
    e2e: path.join(root, 'e2e'),
    results: path.join(root, 'test-results'),
    report: path.join(root, 'report'),
    logs: path.join(root, 'logs'),
  };
  for (const [key, dir] of Object.entries(dirs)) {
    if (key !== 'root' && key !== 'dist' && key !== 'report' && key !== 'results') fs.mkdirSync(dir, { recursive: true });
  }
  for (const sub of ['.cache', '.config', '.local/share', 'AppData/Roaming', 'AppData/Local']) {
    fs.mkdirSync(path.join(dirs.home, sub), { recursive: true });
  }
  return dirs;
}

/**
 * Environnement des processus lancés : dossier personnel, caches et
 * fichiers temporaires redirigés vers l'espace de travail.
 *
 * Seule exception : la configuration npm de l'utilisateur (`~/.npmrc`) est
 * LUE (jamais écrite) pour respecter un éventuel proxy d'entreprise ou un
 * registre privé.
 */
export function isolatedEnv(ws, realHome, extra = {}) {
  const env = { ...process.env };
  const userNpmrc = path.join(realHome, '.npmrc');

  Object.assign(env, {
    HOME: ws.home,
    USERPROFILE: ws.home,
    XDG_CACHE_HOME: path.join(ws.home, '.cache'),
    XDG_CONFIG_HOME: path.join(ws.home, '.config'),
    XDG_DATA_HOME: path.join(ws.home, '.local/share'),
    APPDATA: path.join(ws.home, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(ws.home, 'AppData/Local'),
    TMPDIR: ws.tmp,
    TMP: ws.tmp,
    TEMP: ws.tmp,
    // npm : cache, journaux et vérification de mise à jour dans l'espace jetable.
    npm_config_cache: ws.npmCache,
    npm_config_logs_dir: ws.npmLogs,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    // Navigateurs Playwright et binaire MongoDB : jamais dans le cache global.
    PLAYWRIGHT_BROWSERS_PATH: ws.browsers,
    MONGOMS_DOWNLOAD_DIR: ws.mongoBinaries,
    MONGOMS_PREFER_GLOBAL_PATH: '0',
    // Angular CLI : pas de question sur les statistiques d'usage.
    NG_CLI_ANALYTICS: 'false',
    ...extra,
  });
  if (fs.existsSync(userNpmrc)) env.npm_config_userconfig = userNpmrc;
  return env;
}
