// Núcleo del bot: formato de salida + llamada al modelo.
// Vive aparte de server.js para que el eval pueda importarlo sin levantar Express.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  SYSTEM_PROMPT, MENSAJES_APERTURA, BARRIOS_POR_SEDE, ZONAS_FUERA_DE_CABA,
} from './prompt.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const CONTACTO_WSP = '11 2394 7419';
export const FALLBACK_MSG = `Perdón, se me complicó procesar tu consulta. Escribinos directo al WhatsApp y te respondemos: ${CONTACTO_WSP}`;

// El bot cierra derivando al WhatsApp que atiende Demián, con el resumen de la
// charla ya escrito en el chat. El modelo no arma la URL: escribe [[WSP: resumen]]
// y la reemplazamos acá, porque el url-encoding a mano lo rompe seguido.
export const WSP_BASE =
  'https://api.whatsapp.com/send/?phone=5491123947419&type=phone_number&app_absent=0';

const RESUMEN_POR_DEFECTO =
  'Hola! Vengo del Instagram de Futbol Queens y quiero coordinar una clase de prueba.';

const WSP_MARCA_RE = /\[\[\s*WSP\s*:\s*([\s\S]*?)\]\]/g;

export function linkWsp(resumen = '') {
  const texto = resumen.trim() || RESUMEN_POR_DEFECTO;
  return `${WSP_BASE}&text=${encodeURIComponent(texto)}`;
}

export function insertarLinkWsp(texto) {
  return texto.replace(WSP_MARCA_RE, (_, resumen) => linkWsp(resumen));
}

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
    // El link va último: así la limpieza de markdown y de signos no le toca la URL.
    .map((t) => insertarLinkWsp(limpiarMarkdown(sinSignosDeApertura(t))))
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

// Franja en la que Demián está sobre el WhatsApp. Fuera de ella el bot contesta
// igual, pero no promete respuesta inmediata.
const WSP_DESDE = Number(process.env.WSP_HORA_DESDE ?? 9);
const WSP_HASTA = Number(process.env.WSP_HORA_HASTA ?? 22);

function ahora() {
  const timeZone = process.env.BOT_TZ || 'America/Argentina/Buenos_Aires';
  const d = new Date();
  const fecha = new Intl.DateTimeFormat('es-AR', {
    timeZone, year: 'numeric', month: 'long', day: 'numeric',
  }).format(d);
  const hora = Number(
    new Intl.DateTimeFormat('es-AR', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d),
  );
  return { fecha, hora };
}

function notaHorarioWsp(hora) {
  return hora >= WSP_DESDE && hora < WSP_HASTA
    ? 'A esta hora están atendiendo el WhatsApp: al derivar podés decir que le responden a la brevedad.'
    : `A esta hora NO están atendiendo el WhatsApp. Al derivar NO prometas respuesta inmediata: decile que le van a responder mañana a partir de las ${WSP_DESDE} de la mañana.`;
}

// Devuelve un array de globos de chat listos para enviar.
export async function runBot(messages, { channel = 'web' } = {}) {
  const { fecha, hora } = ahora();
  const system = `Hoy es ${fecha} y son las ${String(hora).padStart(2, '0')} hs. ${notaHorarioWsp(hora)}\n\n${SYSTEM_PROMPT}`;

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

// La apertura tiene dos mensajes: la presentación y "De dónde son ustedes?". Casi
// nadie escribe "hola" pelado: la mayoría arranca con la edad de la nena. Si en ese
// caso mandáramos la apertura Y además dejáramos contestar al modelo, la familia
// recibe cuatro mensajes de una, con el saludo y la pregunta de zona duplicados.
// Así que el modelo habla en el primer turno solamente cuando ya no queda nada que
// preguntar de la apertura, o sea cuando el primer mensaje ya dice de qué zona son.

const sinAcentos = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const ZONAS_CONOCIDAS = [
  ...new Set([
    ...Object.values(BARRIOS_POR_SEDE).flatMap((s) => s.barrios),
    ...Object.keys(BARRIOS_POR_SEDE),
    ...ZONAS_FUERA_DE_CABA,
    'caba', 'capital', 'capital federal',
  ]),
].map(sinAcentos);

// Detecta si el mensaje nombra un barrio, un partido del conurbano o una sede. Es a
// propósito conservador: ante la duda decimos que no y la apertura pregunta la zona,
// que es el peor caso tolerable. Lo intolerable es preguntar algo que ya nos dijeron.
export function mencionaZona(texto) {
  const t = sinAcentos(texto);
  return ZONAS_CONOCIDAS.some((zona) => new RegExp(`(^|[^a-z])${zona}([^a-z]|$)`).test(t));
}

export async function responder(messages, { channel = 'web', esPrimeraRespuesta = false } = {}) {
  if (!esPrimeraRespuesta) return runBot(messages, { channel });

  const primerMensaje = messages.find((m) => m.role === 'user')?.content ?? '';

  // Todavía no sabemos de dónde son: la apertura ya se los pregunta y con eso alcanza.
  if (!mencionaZona(primerMensaje)) return [...MENSAJES_APERTURA];

  // Ya nos dijeron la zona: sacamos la pregunta de la apertura, dejamos la
  // presentación y que siga el modelo. Le recortamos un globo para no abrumar.
  const respuesta = await runBot(messages, { channel });
  return [MENSAJES_APERTURA[0], ...respuesta.slice(0, Math.max(1, MAX_GLOBOS - 1))];
}
