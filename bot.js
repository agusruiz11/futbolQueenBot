// Núcleo del bot: formato de salida + llamada al modelo.
// Vive aparte de server.js para que el eval pueda importarlo sin levantar Express.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, MENSAJES_APERTURA } from './prompt.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const CONTACTO_WSP = '11 2394 7419';
export const FALLBACK_MSG = `Perdón, se me complicó procesar tu consulta. Escribinos directo al WhatsApp y te respondemos: ${CONTACTO_WSP}`;

// ─── Formato de salida ───────────────────────────────────────────────────────

// El guion pide preguntas sin signo de apertura ("De dónde son?" y no "¿De dónde
// son?"). Es una regla que el modelo rompe seguido porque el español correcto sí
// lo lleva, así que además de pedírselo en el prompt la forzamos acá.
export function sinSignosDeApertura(texto) {
  return texto.replace(/[¿¡]/g, '');
}

// El chat no renderiza markdown: sacamos lo que el modelo pueda colar.
export function limpiarMarkdown(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .trim();
}

// El modelo separa cada globo de chat con una línea de tres guiones.
export const MAX_GLOBOS = Number(process.env.MAX_GLOBOS ?? 3);

export function separarEnGlobos(texto) {
  return texto
    .split(/^\s*-{3,}\s*$/m)
    .map((t) => limpiarMarkdown(sinSignosDeApertura(t)))
    .filter(Boolean)
    .slice(0, MAX_GLOBOS);
}

// ─── Llamada al modelo ───────────────────────────────────────────────────────

const MODEL = process.env.BOT_MODEL || 'claude-opus-5';
const EFFORT = process.env.BOT_EFFORT || 'medium';
// Si los clasificadores de seguridad rechazan un pedido, la API lo reintenta sola
// en otro modelo en vez de devolvernos la conversación cortada. Para este bot el
// riesgo de rechazo es prácticamente nulo, así que si la beta no está habilitada
// en la cuenta y la API devuelve 400, se apaga con BOT_FALLBACKS=false.
const FALLBACKS = (process.env.BOT_FALLBACKS || 'true') !== 'false';

export const BOT_CONFIG = { MODEL, EFFORT, MAX_GLOBOS, FALLBACKS };

function fechaHoy() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: process.env.BOT_TZ || 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());
}

// Devuelve un array de globos de chat listos para enviar.
export async function runBot(messages, { channel = 'web' } = {}) {
  const system = `Hoy es ${fechaHoy()}.\n\n${SYSTEM_PROMPT}`;

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages,
    output_config: { effort: EFFORT },
    ...(FALLBACKS ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  });

  // Un rechazo llega como HTTP 200 con content vacío: hay que mirar stop_reason
  // antes de leer el contenido.
  if (response.stop_reason === 'refusal') {
    console.warn(`[bot:${channel}] Respuesta rechazada por los clasificadores`);
    return [FALLBACK_MSG];
  }

  const texto = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const globos = separarEnGlobos(texto);
  return globos.length ? globos : [FALLBACK_MSG];
}

// ─── Apertura ────────────────────────────────────────────────────────────────

// Si el primer mensaje es solo un saludo, los tres mensajes de apertura ya lo
// contestan todo y no hace falta molestar al modelo. Si trae información (edad,
// zona, una pregunta), mandamos la apertura y dejamos que el modelo siga desde ahí.
const SALUDO_RE = /^[\s\p{P}]*(hola+|buenas|buen d[ií]a|buenas tardes|buenas noches|hey|holis|qu[eé] tal|hi)[\s\p{P}]*$/iu;

export function esSoloSaludo(texto) {
  return SALUDO_RE.test((texto || '').trim());
}

export async function responder(messages, { channel = 'web', esPrimeraRespuesta = false } = {}) {
  if (!esPrimeraRespuesta) return runBot(messages, { channel });

  const primerMensaje = messages.find((m) => m.role === 'user')?.content ?? '';
  if (esSoloSaludo(primerMensaje)) return [...MENSAJES_APERTURA];

  const respuesta = await runBot(messages, { channel });
  return [...MENSAJES_APERTURA, ...respuesta];
}
