// El DM automático de Meta a quien comenta un posteo no tiene que pausar al bot;
// una respuesta manual del equipo sí. Levanta server.js y le manda echos.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DM_META = 'Hola, ¿cómo estás? 💜 Somos una escuela de fútbol para niñas y adolescentes de 4 a 17 años, con varias sedes en CABA. Tenemos sedes en Caballito, Villa Crespo, Núñez y Colegiales. De dónde son ustedes?';

function echo(recipientId, text, mid) {
  return {
    object: 'instagram',
    entry: [{ messaging: [{
      sender: { id: 'cuenta-fq' }, recipient: { id: recipientId },
      timestamp: Date.now(), message: { mid, text, is_echo: true },
    }] }],
  };
}

test('echo automático de Meta no pausa; echo manual sí', async (t) => {
  const env = { ...process.env, PORT: String(PORT), IG_APP_SECRET: '', ANTHROPIC_API_KEY: 'test', DOTENV_CONFIG_PATH: '/dev/null' };
  delete env.AUTO_DM_TEXTOS;
  const srv = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env });
  t.after(() => srv.kill());
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });

  const esperar = async (cond, ms = 5000) => {
    const fin = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > fin) throw new Error(`timeout. Log:\n${log}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await esperar(() => log.includes('corriendo'));

  const post = (body) => fetch(`http://localhost:${PORT}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  await post(echo('auto-1', DM_META, 'm-auto-1'));
  await esperar(() => log.includes('Echo de automatización de Meta para auto-1, no pauso'));
  assert.ok(!log.includes('Respuesta manual detectada para auto-1'));
  assert.ok(log.includes('[echo-raw]'));

  await post(echo('manual-1', 'Hola! Te paso la info de la sede de Núñez', 'm-manual-1'));
  await esperar(() => log.includes('Respuesta manual detectada para manual-1'));
  assert.ok(!log.includes('automatización de Meta para manual-1'));
});
