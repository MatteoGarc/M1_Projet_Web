#!/usr/bin/env node
/**
 * Tests de bout en bout (E2E) de Guitar Practice Cloud, dans un
 * environnement ENTIÈREMENT JETABLE.
 *
 *   node e2e/run-e2e.mjs                         # Chromium, Firefox et WebKit
 *   node e2e/run-e2e.mjs --browsers=chromium     # un seul navigateur (plus rapide)
 *   node e2e/run-e2e.mjs --keep-report           # garde le rapport HTML dans e2e/playwright-report
 *   node e2e/run-e2e.mjs --headed -- --grep "connexion"   # options transmises à Playwright
 *
 * Déroulement :
 *  1. photographie de l'état du PC (dépôt, node_modules, caches globaux) ;
 *  2. création d'un dossier temporaire unique ; tout y est installé :
 *     bibliothèques de test (npm), navigateurs Playwright, MongoDB ;
 *  3. build Angular, démarrage de MongoDB (en mémoire), du backend et d'un
 *     petit serveur web, sur des ports libres ;
 *  4. exécution de Playwright ;
 *  5. arrêt de tout, suppression du dossier temporaire — même après une
 *     erreur ou un Ctrl+C ;
 *  6. nouvelle photographie et comparaison : la commande échoue si le PC
 *     n'est pas revenu EXACTEMENT à son état de départ.
 *
 * Jamais : installation globale (`npm -g`), dépendances système
 * (`playwright install --with-deps`, sudo), écriture dans le dépôt
 * (sauf `--keep-report`, demandé explicitement) ou dans les caches de
 * l'utilisateur.
 *
 * Variables facultatives :
 *  - E2E_MONGODB_URI : utiliser un MongoDB existant au lieu de le télécharger.
 *    Une base au nom unique `gpc_e2e_…` y est créée puis SUPPRIMÉE à la fin ;
 *    aucune autre base n'est touchée.
 *  - MONGOMS_SYSTEM_BINARY : chemin d'un `mongod` déjà installé, utilisé au
 *    lieu du téléchargement (la base reste en mémoire, dans le dossier temporaire).
 *  - E2E_CHROMIUM_EXECUTABLE : chemin d'un Chrome/Chromium déjà installé, au
 *    lieu de télécharger celui de Playwright (il est utilisé, jamais modifié).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { freePort, killAllChildren, run, runForCode, startFrontServer, startProcess, waitForHttp } from './lib/processes.mjs';
import { compareSnapshots, takeSnapshot } from './lib/state-check.mjs';
import { createWorkspace, isolatedEnv, removeDir, removeStaleWorkspaces } from './lib/workspace.mjs';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(E2E_DIR, '..');
const FRONT_DIR = path.join(REPO, 'frontend-starter');
const BACK_DIR = path.join(REPO, 'backend');
const REPORT_DIR = path.join(E2E_DIR, 'playwright-report');
const ALL_BROWSERS = ['chromium', 'firefox', 'webkit'];
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ------------------------------------------------------------------ Options
function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  const options = { browsers: ALL_BROWSERS, keepReport: false, headed: false, passthrough };
  for (const arg of own) {
    if (arg.startsWith('--browsers=')) {
      options.browsers = arg.slice('--browsers='.length).split(',').map((b) => b.trim()).filter(Boolean);
      const unknown = options.browsers.filter((b) => !ALL_BROWSERS.includes(b));
      if (unknown.length > 0 || options.browsers.length === 0) {
        throw new Error(`Navigateur inconnu : ${unknown.join(', ') || '(aucun)'} — choix possibles : ${ALL_BROWSERS.join(', ')}`);
      }
    } else if (arg === '--keep-report') {
      options.keepReport = true;
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      throw new Error(`Option inconnue : ${arg} (les options Playwright se placent après « -- »)`);
    }
  }
  return options;
}

const step = (message) => console.log(`\n▶ ${message}`);
const info = (message) => console.log(`  ${message}`);

/** Copie un dossier en excluant certains noms (node_modules, caches…). */
function copyDir(source, target, excluded) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => !excluded.includes(path.basename(src)),
  });
}

/** Ajoute (ou remplace) le nom de base dans une URI MongoDB. */
function withDatabase(uri, database) {
  const [base, query] = uri.split('?');
  const schemeEnd = base.indexOf('://') + 3;
  const slash = base.indexOf('/', schemeEnd);
  const hosts = slash === -1 ? base : base.slice(0, slash);
  return `${hosts}/${database}${query ? `?${query}` : ''}`;
}

// --------------------------------------------------------------- Programme
const originalEnv = { ...process.env };
const realHome = os.homedir();
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(2);
}

const cleanupTasks = [];
let cleaningUp = null;
let ws = null;

/** Arrête tout et supprime l'espace jetable. Idempotent. */
function cleanup() {
  cleaningUp ??= (async () => {
    step('Nettoyage');
    for (const task of cleanupTasks.reverse()) {
      try {
        await task.run();
        info(`✔ ${task.label}`);
      } catch (error) {
        info(`⚠ ${task.label} : ${error.message}`);
      }
    }
    killAllChildren('SIGKILL');
    // L'environnement du lanceur lui-même est rétabli avant la photo finale.
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    if (ws) {
      removeDir(ws.root);
      info(`✔ Dossier temporaire supprimé (${ws.root})`);
    }
  })();
  return cleaningUp;
}

let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\n✖ Interruption (${signal}) : arrêt des processus puis nettoyage…`);
    // Les étapes en cours échouent, puis le programme principal nettoie et
    // vérifie l'état du PC comme d'habitude.
    killAllChildren('SIGTERM');
    setTimeout(() => killAllChildren('SIGKILL'), 5000).unref();
    // Filet de sécurité si une étape interne (ex. téléchargement de MongoDB)
    // ne s'interrompt pas d'elle-même.
    setTimeout(() => void cleanup().finally(() => process.exit(130)), 30_000).unref();
  });
}

async function main() {
  const stale = removeStaleWorkspaces();
  if (stale.length > 0) info(`Restes d'une exécution interrompue supprimés : ${stale.join(', ')}`);

  step('Photographie de l’état initial du PC');
  const ignored = options.keepReport ? ['e2e/playwright-report'] : [];
  const before = takeSnapshot({ repo: REPO, home: realHome, ignored });
  info(`${before.hard.size} éléments enregistrés`);

  let testCode = 1;
  try {
    testCode = await runTests();
  } catch (error) {
    console.error(interrupted ? '\n✖ Exécution interrompue.' : `\n✖ ${error.message}`);
    if (!interrupted && error.logFile && fs.existsSync(error.logFile)) {
      console.error(`--- fin du journal ${path.basename(error.logFile)} ---`);
      console.error(fs.readFileSync(error.logFile, 'utf8').split('\n').slice(-40).join('\n'));
    }
  } finally {
    await cleanup();
  }

  step('Vérification : le PC est-il revenu à son état initial ?');
  const after = takeSnapshot({ repo: REPO, home: realHome, ignored });
  const { differences, warnings } = compareSnapshots(before, after);
  for (const warning of warnings) info(`⚠ ${warning} (peut venir d’un autre logiciel)`);
  if (differences.length > 0) {
    console.error('✖ Le PC n’est PAS dans son état initial :');
    for (const difference of differences) console.error(`    ${difference}`);
    return 3;
  }
  info('✔ Aucune différence : navigateurs, bibliothèques, caches et dépôt sont inchangés.');
  if (options.keepReport && fs.existsSync(REPORT_DIR)) {
    info(`Seul ajout, demandé avec --keep-report : ${REPORT_DIR}`);
  }
  return testCode;
}

async function runTests() {
  ws = createWorkspace();
  info(`Dossier temporaire : ${ws.root}`);
  const env = isolatedEnv(ws, realHome);
  // Le lanceur lui-même (MongoDB en mémoire) écrit aussi dans l'espace jetable.
  Object.assign(process.env, {
    TMPDIR: ws.tmp,
    TMP: ws.tmp,
    TEMP: ws.tmp,
    MONGOMS_DOWNLOAD_DIR: ws.mongoBinaries,
    MONGOMS_PREFER_GLOBAL_PATH: '0',
  });

  // ---------------------------------------------- Bibliothèques de test
  step('Installation des bibliothèques de test (dans le dossier temporaire)');
  for (const name of ['package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json']) {
    fs.copyFileSync(path.join(E2E_DIR, name), path.join(ws.e2e, name));
  }
  fs.cpSync(path.join(E2E_DIR, 'tests'), path.join(ws.e2e, 'tests'), { recursive: true });
  await run(NPM, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: ws.e2e,
    env,
    logFile: path.join(ws.logs, 'npm-e2e.log'),
    label: 'npm ci (bibliothèques de test)',
  });
  const e2eRequire = createRequire(path.join(ws.e2e, 'package.json'));
  const playwrightCli = e2eRequire.resolve('@playwright/test/cli');
  info('✔ @playwright/test et mongodb-memory-server-core installés');

  // Bibliothèques de l'application : celles déjà installées par le
  // développeur sont utilisées en LECTURE ; sinon, copie + installation
  // dans le dossier temporaire (le dépôt n'est pas modifié).
  const frontDir = await appDir(FRONT_DIR, '@angular/cli', 'frontend', env);
  const backDir = await appDir(BACK_DIR, 'express', 'backend', env);

  // -------------------------------------------------------- Build Angular
  step('Build de l’application Angular');
  await run(process.execPath, [path.join(frontDir, 'node_modules/@angular/cli/bin/ng.js'), 'build', '--output-path', ws.dist], {
    cwd: frontDir,
    // CI=1 désactive le cache disque d'Angular (`.angular/cache`).
    env: { ...env, CI: '1' },
    logFile: path.join(ws.logs, 'ng-build.log'),
    label: 'ng build',
  });
  info('✔ Build terminé');

  // ------------------------------------------------------- Navigateurs
  const chromiumExecutable = process.env.E2E_CHROMIUM_EXECUTABLE;
  const toInstall = options.browsers.filter((b) => !(b === 'chromium' && chromiumExecutable));
  step(`Navigateurs : ${options.browsers.join(', ')}`);
  if (chromiumExecutable) info(`Chromium : ${chromiumExecutable} (déjà installé, utilisé tel quel)`);
  if (toInstall.length > 0) {
    info(`Téléchargement de ${toInstall.join(', ')} dans le dossier temporaire…`);
    // Sans `--with-deps` : aucune dépendance système n'est installée.
    await run(process.execPath, [playwrightCli, 'install', ...toInstall], {
      cwd: ws.e2e,
      env,
      logFile: path.join(ws.logs, 'playwright-install.log'),
      label: 'playwright install',
    });
    info('✔ Navigateurs prêts');
  }

  // ------------------------------------------------------------ MongoDB
  step('Base de données');
  const database = `gpc_e2e_${crypto.randomBytes(4).toString('hex')}`;
  let mongoUri;
  const { MongoClient } = e2eRequire('mongodb');
  if (process.env.E2E_MONGODB_URI) {
    mongoUri = withDatabase(process.env.E2E_MONGODB_URI, database);
    info(`MongoDB existant, base temporaire « ${database} »`);
    cleanupTasks.push({
      label: `Base temporaire « ${database} » supprimée`,
      run: async () => {
        const client = await MongoClient.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        try {
          await client.db(database).dropDatabase();
        } finally {
          await client.close();
        }
      },
    });
  } else {
    info(
      process.env.MONGOMS_SYSTEM_BINARY
        ? `MongoDB en mémoire avec ${process.env.MONGOMS_SYSTEM_BINARY} (données dans le dossier temporaire)…`
        : 'Téléchargement et démarrage de MongoDB en mémoire (dossier temporaire)…',
    );
    const { MongoMemoryServer } = e2eRequire('mongodb-memory-server-core');
    const mongo = await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1', dbPath: ws.mongoData },
      binary: { downloadDir: ws.mongoBinaries },
    });
    cleanupTasks.push({ label: 'MongoDB arrêté', run: () => mongo.stop({ doCleanup: true, force: true }) });
    mongoUri = withDatabase(mongo.getUri(), database);
    info('✔ MongoDB démarré');
  }

  // ------------------------------------------------------------ Backend
  step('Démarrage du backend et du serveur web');
  const backendPort = await freePort();
  const backend = startProcess(process.execPath, [path.join(backDir, 'src/server.js')], {
    // Le backend écrit les fichiers uploadés dans `./data/uploads` :
    // son dossier courant est dans l'espace jetable, pas dans le dépôt.
    cwd: ws.backendCwd,
    env: { ...env, PORT: String(backendPort), MONGODB_URI: mongoUri, JWT_SECRET: crypto.randomBytes(32).toString('hex') },
    logFile: path.join(ws.logs, 'backend.log'),
  });
  cleanupTasks.push({ label: 'Backend arrêté', run: () => backend.stop() });
  try {
    await waitForHttp(`http://127.0.0.1:${backendPort}/api/health`, { isDead: () => backend.exited });
  } catch (error) {
    throw Object.assign(error, { logFile: path.join(ws.logs, 'backend.log') });
  }
  const front = await startFrontServer(path.join(ws.dist, 'browser'), backendPort);
  cleanupTasks.push({ label: 'Serveur web arrêté', run: () => front.stop() });
  info(`✔ Application disponible sur ${front.url}`);

  // ---------------------------------------------------------- Playwright
  step('Exécution des tests Playwright');
  const args = ['test', '--config', path.join(ws.e2e, 'playwright.config.ts')];
  for (const browser of options.browsers) args.push(`--project=${browser}`);
  if (options.headed) args.push('--headed');
  args.push(...options.passthrough);
  const code = await runForCode(process.execPath, [playwrightCli, ...args], {
    label: 'Playwright',
    cwd: ws.e2e,
    env: {
      ...env,
      E2E_BASE_URL: front.url,
      E2E_OUTPUT_DIR: ws.results,
      E2E_REPORT_DIR: ws.report,
      ...(chromiumExecutable ? { E2E_CHROMIUM_EXECUTABLE: chromiumExecutable } : {}),
    },
  });

  if (options.keepReport && fs.existsSync(ws.report)) {
    removeDir(REPORT_DIR);
    fs.cpSync(ws.report, REPORT_DIR, { recursive: true });
    // Journaux du backend, du build et des installations : utiles pour comprendre un échec.
    fs.cpSync(ws.logs, path.join(REPORT_DIR, 'logs'), { recursive: true });
    info(`Rapport HTML conservé : ${REPORT_DIR} (journaux dans logs/)`);
  } else if (code !== 0) {
    info('Astuce : relancez avec --keep-report pour garder le rapport HTML (traces, captures).');
  }
  return code;
}

/**
 * Dossier d'une application (frontend ou backend) prête à l'emploi.
 * Si ses `node_modules` sont déjà installés, on les utilise sans les
 * modifier ; sinon on copie l'application dans l'espace jetable et on y
 * installe ses dépendances.
 */
async function appDir(dir, probe, label, env) {
  if (fs.existsSync(path.join(dir, 'node_modules', probe, 'package.json'))) {
    info(`${label} : dépendances déjà installées, utilisées en lecture seule`);
    return dir;
  }
  step(`Installation des dépendances du ${label} (dans le dossier temporaire)`);
  const copy = path.join(ws.deps, label);
  copyDir(dir, copy, ['node_modules', '.angular', 'dist', 'data', '.env']);
  await run(NPM, ['ci', '--no-audit', '--no-fund'], {
    cwd: copy,
    env,
    logFile: path.join(ws.logs, `npm-${label}.log`),
    label: `npm ci (${label})`,
  });
  return copy;
}

const code = await main();
process.exit(interrupted ? 130 : code);
