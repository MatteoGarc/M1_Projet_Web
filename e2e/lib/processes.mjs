/**
 * Lancement des processus (npm, Angular CLI, backend, Playwright) et petit
 * serveur HTTP qui sert le build Angular et relaie `/api` vers le backend
 * (comme `proxy.conf.json` en développement), sur des ports libres :
 * les tests n'entrent jamais en conflit avec un `ng serve` ou un backend
 * déjà démarrés par le développeur.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const children = new Set();

/** Exécute une commande et attend sa fin. Rejette si le code de sortie ≠ 0. */
export function run(command, args, { cwd, env, logFile, label = command } = {}) {
  return new Promise((resolve, reject) => {
    const log = logFile ? fs.openSync(logFile, 'a') : null;
    const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd,
      env,
      shell: isWindowsScript,
      stdio: log === null ? 'inherit' : ['ignore', log, log],
    });
    children.add(child);
    child.on('error', (error) => {
      children.delete(child);
      if (log !== null) fs.closeSync(log);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (log !== null) fs.closeSync(log);
      if (code === 0) resolve(0);
      else reject(Object.assign(new Error(`${label} a échoué (code ${code ?? signal})`), { code, logFile }));
    });
  });
}

/** Comme `run`, mais renvoie le code de sortie au lieu de rejeter. */
export async function runForCode(command, args, options) {
  try {
    return await run(command, args, options);
  } catch (error) {
    if (typeof error.code === 'number') return error.code;
    throw error;
  }
}

/** Lance un processus de longue durée (le backend) et renvoie une fonction d'arrêt. */
export function startProcess(command, args, { cwd, env, logFile }) {
  const log = fs.openSync(logFile, 'a');
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', log, log] });
  children.add(child);
  let exited = false;
  const exitPromise = new Promise((resolve) =>
    child.on('exit', (code) => {
      exited = true;
      children.delete(child);
      fs.closeSync(log);
      resolve(code);
    }),
  );
  return {
    child,
    get exited() {
      return exited;
    },
    async stop() {
      if (exited) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exitPromise;
      clearTimeout(timer);
    },
  };
}

/**
 * Arrête tous les processus encore actifs. `SIGTERM` d'abord : Playwright
 * peut ainsi fermer proprement ses navigateurs ; `SIGKILL` en dernier recours.
 */
export function killAllChildren(signal = 'SIGTERM') {
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // Déjà terminé.
    }
  }
}

/** Demande au système un port TCP libre. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Attend qu'une URL réponde 200 (ex. `/api/health`). */
export async function waitForHttp(url, { timeoutMs = 60_000, isDead = () => false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead()) throw new Error(`Le processus s'est arrêté avant de répondre sur ${url}`);
    const ok = await new Promise((resolve) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(2000, () => request.destroy());
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Pas de réponse de ${url} après ${timeoutMs / 1000} s`);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Sert le build Angular (`root`) et relaie `/api/*` vers le backend.
 * Les URL sans extension renvoient `index.html` (routes Angular).
 */
export function startFrontServer(root, backendPort) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/api') {
      const upstream = http.request(
        { host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Backend injoignable' }));
      });
      req.pipe(upstream);
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.resolve(root, `.${pathname}`);
    // Empêche de sortir du dossier du build (`/../../etc/passwd`).
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(pathname)) {
        res.writeHead(404).end();
        return;
      }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
