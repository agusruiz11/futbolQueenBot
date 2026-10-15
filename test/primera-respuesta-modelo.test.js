// La primera respuesta cuando contesta el modelo, de punta a punta por responder()
// contra un mock de la API de Anthropic: la pregunta de zona no se pierde en el
// recorte (eval O1) y al lead del anuncio le llega el aviso de asistente virtual.
//   npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let respuestaModelo = '';
const mock = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
      content: [{ type: 'text', text: respuestaModelo }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => mock.listen(0, r));
after(() => mock.close());

// Nada del .env real: ni la key ni la cantidad de globos.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.ANTHROPIC_API_KEY = 'test';
process.env.ANTHROPIC_BASE_URL = `http://localhost:${mock.address().port}`;
process.env.BOT_FALLBACKS = 'false';
delete process.env.PUBLIC_BASE_URL;
delete process.env.MAX_GLOBOS;

const { responder, MAX_GLOBOS } = await import('../bot.js');
const { MENSAJES_APERTURA, AVISO_ASISTENTE_ANUNCIO } = await import('../prompt.js');

test('O1: pregunta concreta sin zona → presentación, respuesta y la pregunta de zona al final', async () => {
  respuestaModelo = [
    'Te cuento que en diciembre la escuela funciona normal hasta más o menos la segunda mitad del mes, y ahí cerramos por verano hasta la segunda mitad de marzo.',
    'Igual pueden sumarse ahora y arrancar antes del cierre, así ya queda con el grupo para la vuelta.',
    'De dónde son ustedes?',
  ].join('\n---\n');
  const globos = await responder(
    [{ role: 'user', content: 'cuáles son los horarios para diciembre?' }],
    { esPrimeraRespuesta: true },
  );
  assert.equal(globos[0], MENSAJES_APERTURA[0]);
  assert.ok(globos.length <= MAX_GLOBOS, `salieron ${globos.length} globos`);
  assert.ok(String(globos.at(-1)).endsWith('De dónde son ustedes?'));
});

test('lead del anuncio: el aviso de asistente virtual va adelante, sin la presentación', async () => {
  respuestaModelo = 'Buenísimo! Y de qué zona son ustedes, así te digo qué sede les queda más cómoda?';
  const globos = await responder([{ role: 'user', content: 'tiene 12' }], { esPrimeraRespuesta: true });
  assert.equal(globos.length, 1, 'el aviso no suma un globo');
  assert.equal(String(globos[0]), `${AVISO_ASISTENTE_ANUNCIO}\n${respuestaModelo}`);
  assert.ok(!globos.some((g) => String(g).includes('Somos una escuela')), 'no repite la presentación');
});

test('lead del anuncio: el aviso va una sola vez, en la primera respuesta', async () => {
  respuestaModelo = 'Genial, en Colegiales tenemos ese grupo.';
  const globos = await responder([
    { role: 'user', content: 'tiene 12' },
    { role: 'assistant', content: `${AVISO_ASISTENTE_ANUNCIO}\nBuenísimo! De qué zona son?` },
    { role: 'user', content: 'Colegiales' },
  ], { esPrimeraRespuesta: false, origen: 'anuncio' });
  assert.ok(!globos.some((g) => String(g).includes(AVISO_ASISTENTE_ANUNCIO)));
});
