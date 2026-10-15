// La apertura fija queda para un saludo o un pedido de info genérico; una pregunta
// concreta en el primer mensaje pasa por el modelo (eval O1-O3, 15/10/2026).
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY ||= 'test';
const { esSaludoOInfo, responder } = await import('../bot.js');
const { MENSAJES_APERTURA } = await import('../prompt.js');

const APERTURA_FIJA = [
  'hola',
  'Hola!',
  'hola?',
  'buenas tardes',
  'Buen día, cómo están?',
  'hola, cómo estás?',
  'info',
  'Info porfa',
  'hola, me interesa',
  'Hola, me pasa info para mi nena de 7 años',
  'quisiera más información',
];

const AL_MODELO = [
  'cuáles son los horarios para diciembre?',
  'queremos arrancar en enero',
  'en marzo se puede empezar?',
  'hola, cuánto sale?',
  'info de precios',
  'mi hija tiene 8 años',
  'hacen colonia en vacaciones?',
];

test('saludos y pedidos de info genéricos reciben la apertura fija', () => {
  for (const texto of APERTURA_FIJA) assert.equal(esSaludoOInfo(texto), true, texto);
});

test('una pregunta o un dato concreto pasa por el modelo', () => {
  for (const texto of AL_MODELO) assert.equal(esSaludoOInfo(texto), false, texto);
});

test('un saludo sin zona recibe los dos mensajes de apertura sin llamar al modelo', async () => {
  const globos = await responder([{ role: 'user', content: 'hola, cómo estás?' }], { esPrimeraRespuesta: true });
  assert.deepEqual(globos, MENSAJES_APERTURA);
});

test('la presentación dice que es una asistente virtual y conserva el texto de AUTO_DM_TEXTOS', () => {
  assert.match(MENSAJES_APERTURA[0], /asistente virtual de Fútbol Queens/);
  assert.ok(MENSAJES_APERTURA[0].includes('Somos una escuela de fútbol para niñas y adolescentes'));
});
