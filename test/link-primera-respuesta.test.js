// La primera respuesta lleva la presentación adelante y recorta un globo de lo
// que escribió el modelo. Ese recorte no se puede llevar el link de WhatsApp.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY ||= 'test';
const { separarEnGlobos, recortarSinPerderLink, GloboLink } = await import('../bot.js');

test('el link sobrevive al recorte de la primera respuesta', () => {
  const globos = separarEnGlobos(
    'En Caballito tenés los Lunes de 18 a 20.\n---\nQuieren venir a probar una clase? Te dejo el link\n---\n[[WSP: Hola! Mi hija tiene 8. Nos interesa Caballito.]]',
  );
  assert.equal(globos.length, 3);
  const recortada = recortarSinPerderLink(globos);
  assert.equal(recortada.length, 3, 'dos globos de texto más el link');
  assert.ok(recortada.at(-1) instanceof GloboLink, 'el link queda último');
});

test('sin link, el recorte sigue igual', () => {
  const recortada = recortarSinPerderLink(separarEnGlobos('Uno\n---\nDos\n---\nTres'));
  assert.deepEqual(recortada.map(String), ['Uno', 'Dos']);
});

test('si el link ya entró en el recorte, no se duplica', () => {
  const recortada = recortarSinPerderLink(separarEnGlobos('Te dejo el link\n---\n[[WSP: Hola!]]\n---\nCualquier cosa avisame'));
  assert.equal(recortada.filter((g) => g instanceof GloboLink).length, 1);
  assert.equal(recortada.length, 2);
});
