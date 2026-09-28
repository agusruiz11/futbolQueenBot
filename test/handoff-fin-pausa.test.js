// Cuando vence la pausa por handoff humano, el bot recarga la charla desde
// Instagram: ve lo que la familia escribió durante la pausa (se había descartado)
// y lo que le contestó el equipo a mano. Levanta server.js contra un mock de la
// Graph API de Instagram y de la API de Anthropic.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4000 + Math.floor(Math.random() * 90);
const FAM = 'fam-1';
const RESPUESTA_EQUIPO = 'Hola! Te paso la info de la sede de Núñez: martes y jueves 18 hs';

// Adelanta el reloj del server 3 hs cuando le llega SIGUSR2 (la pausa dura 2).
const RELOJ = 'data:text/javascript,' + encodeURIComponent(
  'let d=0;const r=Date.now;Date.now=()=>r()+d;process.on("SIGUSR2",()=>{d+=3*3600e3;console.log("[test] reloj +3h")});',
);

// Instagram guarda la charla entera, del más nuevo al más viejo.
const CONVERSACION = [
  { created_time: new Date().toISOString(), from: { id: FAM }, message: 'hola? sigue la info?' },
  { created_time: new Date().toISOString(), from: { id: FAM }, message: 'Caballito' },
  { created_time: new Date().toISOString(), from: { id: 'cuenta-fq' }, message: RESPUESTA_EQUIPO },
  { created_time: new Date().toISOString(), from: { id: FAM }, message: 'Hola, quiero info para mi hija de 9' },
];

test('al vencer la pausa, retoma con el historial de Instagram', async (t) => {
  const pedidosModelo = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/me/conversations')) {
        return res.end(JSON.stringify({ data: [{ messages: { data: CONVERSACION } }] }));
      }
      if (req.url.startsWith('/me/messages')) return res.end(JSON.stringify({ message_id: `m-${Math.random()}` }));
      if (req.url.startsWith('/v1/messages')) {
        pedidosModelo.push(JSON.parse(body));
        return res.end(JSON.stringify({
          id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
          content: [{ type: 'text', text: 'Genial, en Caballito tenemos lugar.' }],
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
    ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: MOCK,
    IG_AGRUPAR_MS: '100', IG_MSG_DELAY_MS: '0', IG_MSG_JITTER_MS: '0', IG_TYPING: 'false',
  };
  for (const k of ['IG_BOT_START_HOUR', 'IG_BOT_END_HOUR', 'IG_ENABLED', 'PUBLIC_BASE_URL']) delete env[k];
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
  const deFamilia = (text, mid) => post({ sender: { id: FAM }, recipient: { id: 'cuenta-fq' }, timestamp: Date.now(), message: { mid, text } });
  await esperar(() => log.includes('corriendo'));

  // Contesta alguien del equipo: pausa.
  await post({ sender: { id: 'cuenta-fq' }, recipient: { id: FAM }, timestamp: Date.now(), message: { mid: 'm-eq', text: RESPUESTA_EQUIPO, is_echo: true } });
  await esperar(() => log.includes(`Respuesta manual detectada para ${FAM}`));

  // La familia escribe durante la pausa: se descarta.
  await deFamilia('Caballito', 'm-f1');
  await esperar(() => log.includes(`Charla con ${FAM} pausada por handoff humano`));

  // Pasan 3 hs y vuelve a escribir.
  srv.kill('SIGUSR2');
  await esperar(() => log.includes('reloj +3h'));
  await deFamilia('hola? sigue la info?', 'm-f2');
  await esperar(() => log.includes(`Fin de la pausa para ${FAM}: retomo con el historial de Instagram`));
  await esperar(() => pedidosModelo.length > 0);

  const msgs = pedidosModelo.at(-1).messages;
  const texto = (m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text || '').join(''));
  assert.ok(msgs.some((m) => m.role === 'assistant' && texto(m).includes(RESPUESTA_EQUIPO)), 'el modelo ve la respuesta del equipo');
  assert.ok(texto(msgs.at(-1)).includes('Caballito') && texto(msgs.at(-1)).includes('hola? sigue la info?'), 'el último turno junta lo de la pausa y lo nuevo');
});
