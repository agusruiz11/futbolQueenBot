// Corre los casos de eval/dataset.json contra el bot real y los evalúa con un juez.
//
//   node eval/run-eval.js                    (pide confirmación: gasta tokens)
//   node eval/run-eval.js --categoria B
//   node eval/run-eval.js --casos B4,C2,I1
//   node eval/run-eval.js --yes              (sin confirmación)

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { responder } from '../bot.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JUEZ_MODEL = process.env.EVAL_JUDGE_MODEL || 'claude-opus-5';
const CONCURRENCIA = Number(process.env.EVAL_CONCURRENCY ?? 4);

// ─── Argumentos ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { categoria: null, casos: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--categoria') args.categoria = argv[++i]?.toUpperCase();
    else if (argv[i] === '--casos') args.casos = argv[++i]?.split(',').map((s) => s.trim().toUpperCase());
    else if (argv[i] === '--yes' || argv[i] === '-y') args.yes = true;
  }
  return args;
}

function confirmar(pregunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close();
      resolve(/^s(i|í)?$/i.test(respuesta.trim()));
    });
  });
}

// ─── Ejecución de un caso ────────────────────────────────────────────────────

// Replica la conversación turno por turno y devuelve la transcripción completa.
async function correrCaso(caso) {
  const messages = [];
  const transcripcion = [];

  for (const turno of caso.turnos) {
    messages.push({ role: 'user', content: turno });
    transcripcion.push({ quien: 'usuario', texto: turno });

    const esPrimeraRespuesta = !messages.some((m) => m.role === 'assistant');
    const globos = await responder(messages, { channel: 'web', esPrimeraRespuesta });

    messages.push({ role: 'assistant', content: globos.join('\n') });
    transcripcion.push({ quien: 'bot', globos });
  }

  return transcripcion;
}

// ─── Juez ────────────────────────────────────────────────────────────────────

const ESQUEMA_VEREDICTO = {
  type: 'object',
  properties: {
    veredicto: {
      type: 'string',
      enum: ['PASS', 'FAIL', 'REVIEW'],
      description: 'PASS si cumple todos los criterios. FAIL si incumple alguno de forma clara. REVIEW si es ambiguo o depende de criterio humano.',
    },
    motivo: {
      type: 'string',
      description: 'Una o dos oraciones explicando el veredicto. Si es FAIL, citá el criterio incumplido y la parte de la respuesta que lo incumple.',
    },
    criterios_fallados: {
      type: 'array',
      items: { type: 'string' },
      description: 'Los criterios que no se cumplieron. Vacío si el veredicto es PASS.',
    },
  },
  required: ['veredicto', 'motivo', 'criterios_fallados'],
  additionalProperties: false,
};

const SYSTEM_JUEZ = `Sos un evaluador de un chatbot de atención al cliente de una escuela de fútbol infantil.

Te paso la transcripción de una conversación y una lista de criterios. Tu trabajo es decidir si el bot los cumplió.

Reglas de evaluación:
- Evaluá SOLO contra los criterios que te doy. No agregues expectativas propias sobre tono, largo o redacción.
- El bot habla en español rioplatense informal. Eso es correcto, no lo marques como error.
- El guion pide preguntas SIN el signo de apertura "¿". Que escriba "De dónde son?" es lo esperado, NO un error de ortografía.
- Los mensajes cortos y separados en globos son intencionales, no un defecto.
- Marcá FAIL solo cuando el incumplimiento es claro y verificable en el texto. Si el bot dice lo mismo con otras palabras, es PASS.
- Usá REVIEW cuando el caso sea genuinamente ambiguo o cuando el criterio dependa de un juicio que no podés hacer desde el texto.
- Un dato numérico equivocado (un precio, un horario, una edad) es siempre FAIL.`;

async function juzgar(caso, transcripcion) {
  const conversacion = transcripcion
    .map((t) => (t.quien === 'usuario'
      ? `USUARIO: ${t.texto}`
      : t.globos.map((g, i) => `BOT (globo ${i + 1}): ${g}`).join('\n')))
    .join('\n\n');

  const criterios = caso.criterios.map((c, i) => `${i + 1}. ${c}`).join('\n');

  const response = await client.messages.create({
    model: JUEZ_MODEL,
    max_tokens: 4096,
    system: SYSTEM_JUEZ,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ESQUEMA_VEREDICTO },
    },
    messages: [{
      role: 'user',
      content: `CASO ${caso.id} — ${caso.descripcion}\n\nCRITERIOS:\n${criterios}\n\nTRANSCRIPCIÓN:\n${conversacion}`,
    }],
  });

  const texto = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(texto);
}

// ─── Concurrencia limitada ───────────────────────────────────────────────────

async function enLotes(items, limite, fn) {
  const resultados = [];
  for (let i = 0; i < items.length; i += limite) {
    const lote = items.slice(i, i + limite);
    resultados.push(...await Promise.all(lote.map(fn)));
  }
  return resultados;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const COLOR = { PASS: '\x1b[32m', FAIL: '\x1b[31m', REVIEW: '\x1b[33m', ERROR: '\x1b[31m', reset: '\x1b[0m' };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = JSON.parse(fs.readFileSync(path.join(AQUI, 'dataset.json'), 'utf8'));

  let casos = dataset.casos;
  if (args.categoria) casos = casos.filter((c) => c.categoria === args.categoria);
  if (args.casos) casos = casos.filter((c) => args.casos.includes(c.id));

  if (!casos.length) {
    console.error('No hay casos que coincidan con el filtro.');
    process.exit(1);
  }

  const llamadas = casos.reduce((acc, c) => acc + c.turnos.length + 1, 0);
  console.log(`\nVan a correr ${casos.length} casos (~${llamadas} llamadas a la API, modelo ${JUEZ_MODEL}).`);

  if (!args.yes) {
    const ok = await confirmar('Esto consume tokens. Seguimos? (si/no) ');
    if (!ok) { console.log('Cancelado.'); process.exit(0); }
  }

  console.log('');
  const inicio = Date.now();

  const resultados = await enLotes(casos, CONCURRENCIA, async (caso) => {
    try {
      const transcripcion = await correrCaso(caso);
      const veredicto = await juzgar(caso, transcripcion);
      const c = COLOR[veredicto.veredicto] || '';
      console.log(`${c}${veredicto.veredicto.padEnd(6)}${COLOR.reset} ${caso.id}  ${caso.descripcion}`);
      if (veredicto.veredicto !== 'PASS') console.log(`       ↳ ${veredicto.motivo}`);
      return { ...caso, transcripcion, ...veredicto };
    } catch (err) {
      console.log(`${COLOR.ERROR}ERROR ${COLOR.reset} ${caso.id}  ${err.message}`);
      return { ...caso, veredicto: 'ERROR', motivo: err.message, criterios_fallados: [] };
    }
  });

  const cuenta = resultados.reduce((acc, r) => ({ ...acc, [r.veredicto]: (acc[r.veredicto] || 0) + 1 }), {});
  const segundos = ((Date.now() - inicio) / 1000).toFixed(0);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PASS ${cuenta.PASS || 0}  ·  FAIL ${cuenta.FAIL || 0}  ·  REVIEW ${cuenta.REVIEW || 0}  ·  ERROR ${cuenta.ERROR || 0}   (${segundos}s)`);

  const dir = path.join(AQUI, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const nombre = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
  const archivo = path.join(dir, nombre);
  fs.writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), modelo: JUEZ_MODEL, resumen: cuenta, resultados }, null, 2));
  console.log(`Detalle completo en eval/results/${nombre}\n`);

  process.exit((cuenta.FAIL || 0) + (cuenta.ERROR || 0) > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
