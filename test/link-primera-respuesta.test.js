// La primera respuesta lleva la presentación adelante y recorta un globo de lo
// que escribió el modelo. Ese recorte no se puede llevar el link de WhatsApp.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY ||= 'test';
const { separarEnGlobos, recortarSinPerderLink, GloboLink, MAX_GLOBOS } = await import('../bot.js');
const { MENSAJES_APERTURA } = await import('../prompt.js');

test('el link sobrevive al recorte de la primera respuesta', () => {
  const globos = separarEnGlobos(
    'En Caballito tenés los Lunes de 18 a 20.\n---\nQuieren venir a probar una clase? Te dejo el link\n---\n[[WSP: Hola! Mi hija tiene 8. Nos interesa Caballito.]]',
  );
  assert.equal(globos.length, 3);
  const recortada = recortarSinPerderLink(globos);
  assert.equal(recortada.length, 2, 'un globo de texto y el del link');
  assert.equal(String(recortada[0]), 'En Caballito tenés los Lunes de 18 a 20.');
  assert.ok(recortada.at(-1) instanceof GloboLink, 'el link queda último');
  assert.ok(String(recortada.at(-1)).startsWith('Quieren venir a probar una clase? Te dejo el link\n'), 'el texto recortado va adelante del link');
});

test('A4: con la presentación adelante salen sede, horario y link en MAX_GLOBOS', () => {
  // La respuesta real del eval A4 (15/10/2026): el link venía pegado al tercer globo.
  const globos = separarEnGlobos([
    'Genial, en Caballito les queda la sede de Galicia 1973.',
    'Ahí el grupo entrena los Lunes de 18 a 20 hs, y también está la opción de sumar los Miércoles de 17.30 a 19 hs.',
    'Quieren venir a probar una clase sin costo? Te dejo el link, abre el WhatsApp del equipo con el resumen de lo que hablamos acá.\n\n[[WSP: Hola! Vengo del Instagram de Futbol Queens. Tengo una hija de 8 anos y nos interesa la sede de Caballito. Queriamos coordinar una clase de prueba.]]',
  ].join('\n---\n'));
  const primeraRespuesta = [MENSAJES_APERTURA[0], ...recortarSinPerderLink(globos)];
  const texto = primeraRespuesta.map(String).join('\n');

  assert.ok(primeraRespuesta.length <= MAX_GLOBOS, `salieron ${primeraRespuesta.length} globos`);
  assert.ok(texto.includes('Galicia 1973'), 'la sede');
  assert.ok(texto.includes('Lunes de 18 a 20 hs'), 'el horario');
  const link = primeraRespuesta.at(-1);
  assert.ok(link instanceof GloboLink, 'el link no se pierde');
  assert.ok(link.extra.startsWith('Ahí el grupo entrena'), 'Instagram manda el horario antes del botón');
  assert.equal(link.resumen, 'Hola! Vengo del Instagram de Futbol Queens. Tengo una hija de 8 anos y nos interesa la sede de Caballito. Queriamos coordinar una clase de prueba.');
  assert.ok(link.texto.endsWith(link.link), 'en texto, el link va al final');
});

// La respuesta real del modelo a O1 (15/10/2026), antes del recorte.
const RESPUESTA_O1 = [
  'Te cuento que en diciembre la escuela funciona normal hasta más o menos la segunda mitad del mes, y ahí cerramos por verano hasta la segunda mitad de marzo.',
  'Igual pueden sumarse ahora y arrancar antes del cierre, así ya queda con el grupo para la vuelta.',
  'De dónde son ustedes?',
].join('\n---\n');

test('O1: sin zona, el recorte conserva la pregunta final y no pasa de MAX_GLOBOS', () => {
  const recortada = recortarSinPerderLink(separarEnGlobos(RESPUESTA_O1), { conservarPregunta: true });
  assert.ok(1 + recortada.length <= MAX_GLOBOS, `con la presentación salen ${1 + recortada.length} globos`);
  assert.ok(String(recortada[0]).startsWith('Te cuento que en diciembre'), 'el cierre de verano');
  assert.ok(String(recortada.at(-1)).includes('arrancar antes del cierre'), 'el segundo globo no se pierde');
  assert.ok(String(recortada.at(-1)).endsWith('De dónde son ustedes?'), 'termina preguntando la zona');
});

test('con zona, la pregunta final se recorta como antes', () => {
  const recortada = recortarSinPerderLink(separarEnGlobos(RESPUESTA_O1));
  assert.equal(recortada.length, 2);
  assert.ok(!String(recortada.at(-1)).includes('De dónde son'));
});

test('si el link quedó en el recorte, la pregunta final va después del link en el mismo globo', () => {
  const recortada = recortarSinPerderLink(
    separarEnGlobos('Te cuento\n---\nTe dejo el link\n[[WSP: Hola!]]\n---\nDe dónde son?'),
    { conservarPregunta: true },
  );
  assert.equal(recortada.length, 2);
  assert.ok(recortada[1] instanceof GloboLink);
  assert.ok(recortada[1].texto.endsWith('\nDe dónde son?'));
  assert.equal(recortada[1].resumen, 'Hola!');
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
