// El DM automático de Meta a quien comenta un posteo no tiene que pausar al bot;
// una respuesta manual del equipo sí. Levanta server.js y le manda echos.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENSAJES_APERTURA, AVISO_ASISTENTE_ANUNCIO } from '../prompt.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// Levanta server.js con AUTO_DM_TEXTOS en `autoDm` (undefined: el valor por defecto).
async function levantar(t, puertoBase, autoDm) {
  const port = puertoBase + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), IG_APP_SECRET: '', ANTHROPIC_API_KEY: 'test', DOTENV_CONFIG_PATH: '/dev/null' };
  delete env.AUTO_DM_TEXTOS;
  if (autoDm !== undefined) env.AUTO_DM_TEXTOS = autoDm;
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

  const post = (body) => fetch(`http://localhost:${port}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { post, esperar, log: () => log };
}

test('echo automático de Meta no pausa; echo manual sí', async (t) => {
  const { post, esperar, log } = await levantar(t, 3900);

  await post(echo('auto-1', DM_META, 'm-auto-1'));
  await esperar(() => log().includes('Echo de automatización de Meta para auto-1, no pauso'));
  assert.ok(!log().includes('Respuesta manual detectada para auto-1'));
  assert.ok(log().includes('[echo-raw]'));

  // La presentación del bot (con "asistente virtual" adelante) tampoco pausa,
  // aunque el echo llegue sin que el server sepa que fue un envío propio.
  await post(echo('apertura-1', MENSAJES_APERTURA[0], 'm-apertura-1'));
  await esperar(() => log().includes('Echo de automatización de Meta para apertura-1, no pauso'));
  assert.ok(!log().includes('Respuesta manual detectada para apertura-1'));

  // El primer globo de un lead del anuncio (aviso + respuesta del modelo) no trae
  // el fragmento de AUTO_DM_TEXTOS: lo reconoce la lista de textos propios del bot,
  // que no sale de la variable.
  await post(echo('anuncio-1', `${AVISO_ASISTENTE_ANUNCIO}\nBuenísimo! Y de qué zona son ustedes?`, 'm-anuncio-1'));
  await esperar(() => log().includes('Echo de un texto fijo del bot para anuncio-1, no pauso'));
  assert.ok(!log().includes('Respuesta manual detectada para anuncio-1'));

  await post(echo('manual-1', 'Hola! Te paso la info de la sede de Núñez', 'm-manual-1'));
  await esperar(() => log().includes('Respuesta manual detectada para manual-1'));
  assert.ok(!log().includes('automatización de Meta para manual-1'));
});

test('con AUTO_DM_TEXTOS cambiada en Railway, los textos fijos del bot siguen sin pausar', async (t) => {
  const { post, esperar, log } = await levantar(t, 4200, 'otra automatizacion');

  for (const [i, texto] of MENSAJES_APERTURA.entries()) {
    await post(echo(`apertura-${i}`, texto, `m-apertura-${i}`));
    await esperar(() => log().includes(`Echo de un texto fijo del bot para apertura-${i}, no pauso`));
    assert.ok(!log().includes(`Respuesta manual detectada para apertura-${i}`));
  }

  await post(echo('anuncio-1', `${AVISO_ASISTENTE_ANUNCIO}\nGenial! Contame de qué zona son?`, 'm-anuncio-1'));
  await esperar(() => log().includes('Echo de un texto fijo del bot para anuncio-1, no pauso'));

  await post(echo('manual-1', 'Hola! Te paso la info de la sede de Núñez', 'm-manual-1'));
  await esperar(() => log().includes('Respuesta manual detectada para manual-1'));
});
