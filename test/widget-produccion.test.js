// El chat de prueba (/ y POST /chat) contesta sin clave y gasta tokens: en
// Railway tiene que quedar apagado, sin cortar la política de privacidad ni el
// webhook de Instagram. Levanta server.js con distintas variables de entorno.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// 4300-4379: no se pisa con los otros tests (corren en paralelo) ni entre los
// dos servidores del último caso, y esquiva los puertos que fetch rechaza.
let usados = 0;

async function levantar(t, extra) {
  const port = 4300 + usados++ * 20 + Math.floor(Math.random() * 20);
  const env = {
    ...process.env, PORT: String(port), DOTENV_CONFIG_PATH: '/dev/null',
    IG_APP_SECRET: '', IG_ACCESS_TOKEN: 'test', IG_VERIFY_TOKEN: 'verif',
    ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    IG_GRAPH_BASE: 'http://127.0.0.1:9', IG_TOKEN_REFRESH: 'false',
    IG_TOKEN_FILE: path.join(os.tmpdir(), `fq-widget-${port}.json`),
  };
  for (const k of ['RAILWAY_ENVIRONMENT', 'WIDGET_WEB']) delete env[k];
  Object.assign(env, extra);
  const srv = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env });
  t.after(() => srv.kill());
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  const fin = Date.now() + 8000;
  while (!log.includes('corriendo')) {
    if (Date.now() > fin) throw new Error(`timeout. Log:\n${log}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  const base = `http://localhost:${port}`;
  return {
    log: () => log,
    get: (p) => fetch(base + p).then((r) => r.status),
    chat: () => fetch(`${base}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then((r) => r.status),
    webhook: () => fetch(`${base}/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'instagram', entry: [] }),
    }).then((r) => r.status),
  };
}

test('en Railway: sin chat de prueba, con privacidad y webhook', async (t) => {
  const s = await levantar(t, { RAILWAY_ENVIRONMENT: 'production' });
  assert.equal(await s.get('/'), 404, 'GET / apagado');
  assert.equal(await s.get('/index.html'), 404, 'index.html apagado');
  assert.equal(await s.chat(), 404, 'POST /chat apagado');
  assert.equal(await s.get('/privacy.html'), 200, 'la política de privacidad sigue');
  assert.equal(await s.get('/webhook?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=ok'), 200, 'handshake de Meta');
  assert.equal(await s.webhook(), 200, 'POST /webhook sigue');
  assert.match(s.log(), /\[widget\] .*APAGADOS/);
});

test('en local: chat de prueba activo', async (t) => {
  const s = await levantar(t, {});
  assert.equal(await s.get('/'), 200);
  assert.equal(await s.chat(), 400, 'POST /chat existe (400 por body vacío)');
  assert.equal(await s.get('/privacy.html'), 200);
  assert.match(s.log(), /\[widget\] .*ACTIVOS/);
});

test('WIDGET_WEB lo fuerza en los dos sentidos', async (t) => {
  const prendido = await levantar(t, { RAILWAY_ENVIRONMENT: 'production', WIDGET_WEB: 'true' });
  assert.equal(await prendido.get('/'), 200);
  assert.equal(await prendido.chat(), 400);
  const apagado = await levantar(t, { WIDGET_WEB: 'false' });
  assert.equal(await apagado.get('/'), 404);
  assert.equal(await apagado.chat(), 404);
  assert.equal(await apagado.get('/privacy.html'), 200);
});
