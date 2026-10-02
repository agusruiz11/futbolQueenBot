// El globo del link de WhatsApp sale en Instagram como button template. Si Meta
// rechaza el template, va el link corto en texto. El echo del botón no tiene que
// pausar al bot, y el historial sigue guardando la marca [[WSP: ...]]. Levanta
// server.js contra un mock de la Graph API de Instagram y de la API de Anthropic.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4100 + Math.floor(Math.random() * 90);
const RESUMEN = 'Hola! Soy la mama de Sofi, tiene 8. Nos interesa Caballito.';
const RESPUESTA = `Te dejo el link para escribirle al equipo\n---\n[[WSP: ${RESUMEN}]]`;

// Adelanta el reloj del server 1 minuto con SIGUSR2: vence la gracia de 15 s en
// la que cualquier echo se toma como propio, y queda solo el chequeo por ownMids.
const RELOJ = 'data:text/javascript,' + encodeURIComponent(
  'let d=0;const r=Date.now;Date.now=()=>r()+d;process.on("SIGUSR2",()=>{d+=60e3;console.log("[test] reloj +1m")});',
);

test('link de WhatsApp como botón, con respaldo en texto si Meta lo rechaza', async (t) => {
  const enviados = [];     // { recipient, message, mid }
  const pedidosModelo = [];
  let n = 0;
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/me/conversations')) return res.end(JSON.stringify({ data: [] }));
      if (req.url.startsWith('/me/messages')) {
        const b = JSON.parse(body);
        if (!b.message) return res.end('{}'); // sender_action
        if (b.recipient.id === 'fam-rechazo' && b.message.attachment) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: { message: 'template no soportado', code: 100 } }));
        }
        const mid = `mid-${++n}`;
        enviados.push({ recipient: b.recipient.id, message: b.message, mid });
        return res.end(JSON.stringify({ recipient_id: b.recipient.id, message_id: mid }));
      }
      if (req.url.startsWith('/v1/messages')) {
        const pedido = JSON.parse(body);
        const triage = JSON.stringify(pedido.system || '').includes('Clasificás');
        if (!triage) pedidosModelo.push(pedido);
        return res.end(JSON.stringify({
          id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
          content: [{ type: 'text', text: triage ? 'FAMILIA' : RESPUESTA }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const MOCK = `http://localhost:${mock.address().port}`;
  t.after(() => mock.close());

  const env = {
    ...process.env, PORT: String(PORT), DOTENV_CONFIG_PATH: '/dev/null',
    IG_APP_SECRET: '', IG_ACCESS_TOKEN: 'test', IG_GRAPH_BASE: MOCK,
    ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: MOCK, PUBLIC_BASE_URL: 'https://fq.test',
    IG_DEBOUNCE_MS: '100', IG_DEBOUNCE_MAX_MS: '300', IG_MSG_DELAY_MS: '0', IG_MSG_JITTER_MS: '0', IG_TYPING: 'false',
  };
  // Los links cortos van a un archivo temporal, no al data/ del proyecto.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fq-wsp-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  env.WSP_LINKS_FILE = path.join(tmp, 'wsp-links.json');
  for (const k of ['IG_BOT_START_HOUR', 'IG_BOT_END_HOUR', 'IG_ENABLED']) delete env[k];
  const srv = spawn(process.execPath, ['--import', RELOJ, 'server.js'], { cwd: RAIZ, env });
  t.after(() => srv.kill());
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });

  const esperar = async (cond, ms = 8000) => {
    const fin = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > fin) throw new Error(`timeout. Log:\n${log}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const post = (messaging) => fetch(`http://localhost:${PORT}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: 'instagram', entry: [{ messaging: [messaging] }] }),
  });
  const deFamilia = (fam, text, mid) => post({ sender: { id: fam }, recipient: { id: 'cuenta-fq' }, timestamp: Date.now(), message: { mid, text } });
  const echo = (fam, mid, extra = {}) => post({ sender: { id: 'cuenta-fq' }, recipient: { id: fam }, timestamp: Date.now(), message: { mid, is_echo: true, ...extra } });
  await esperar(() => log.includes('corriendo'));

  // Meta acepta el template: sale el botón con el link largo, no el link en texto.
  await deFamilia('fam-ok', 'Caballito, mi hija tiene 8', 'f-ok-1');
  await esperar(() => log.includes('[wsp] Botón enviado a fam-ok'));
  const aOk = enviados.filter((e) => e.recipient === 'fam-ok');
  const boton = aOk.find((e) => e.message.attachment);
  assert.ok(boton, 'salió un template');
  const payload = boton.message.attachment.payload;
  assert.equal(boton.message.attachment.type, 'template');
  assert.equal(payload.template_type, 'button');
  assert.equal(payload.text, 'Tocá acá para escribirle al equipo con el resumen de lo que hablamos');
  assert.equal(payload.buttons[0].type, 'web_url');
  assert.equal(payload.buttons[0].title, 'Abrir WhatsApp');
  assert.ok(payload.buttons[0].url.startsWith('https://wa.me/'), payload.buttons[0].url);
  assert.equal(new URL(payload.buttons[0].url).searchParams.get('text'), RESUMEN);
  assert.ok(!aOk.some((e) => /wa\.me|fq\.test\/w\//.test(e.message.text || '')), 'el link no sale además en texto');
  assert.ok(aOk.some((e) => e.message.text === 'Te dejo el link para escribirle al equipo'), 'el globo de texto sigue saliendo');

  // Meta rechaza el template: va el link corto en texto.
  await deFamilia('fam-rechazo', 'Caballito, mi hija tiene 8', 'f-re-1');
  await esperar(() => log.includes('[wsp] Botón rechazado, mando link a fam-rechazo'));
  await esperar(() => enviados.some((e) => e.recipient === 'fam-rechazo' && /^https:\/\/fq\.test\/w\/\S+$/.test(e.message.text || '')));

  // Pasó la gracia de 15 s: el echo del botón se reconoce solo por su message_id.
  srv.kill('SIGUSR2');
  await esperar(() => log.includes('reloj +1m'));
  await echo('fam-ok', boton.mid, { attachments: [{ type: 'template', payload: {} }] });
  // Control: un echo con un mid que no mandó el bot sí pausa, así que el de
  // arriba no pasó de largo por otro motivo.
  await echo('fam-rechazo', 'mid-del-equipo', { text: 'Hola! Soy Demián' });
  await esperar(() => log.includes('Respuesta manual detectada para fam-rechazo'));
  assert.ok(!log.includes('Respuesta manual detectada para fam-ok'), 'el echo del botón no pausa al bot');

  // Segundo turno: el historial que ve el modelo tiene la marca, no una URL propia.
  await deFamilia('fam-ok', 'y cuánto sale?', 'f-ok-2');
  await esperar(() => pedidosModelo.length >= 3);
  const previo = pedidosModelo.at(-1).messages.find((m) => m.role === 'assistant');
  const texto = typeof previo.content === 'string' ? previo.content : previo.content.map((b) => b.text || '').join('');
  assert.ok(texto.includes(`[[WSP: ${RESUMEN}]]`), texto);
  assert.ok(!texto.includes('fq.test/w/'), texto);
});
