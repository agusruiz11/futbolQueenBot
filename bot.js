// Núcleo del bot: formato de salida + llamada al modelo.
// Vive aparte de server.js para que el eval pueda importarlo sin levantar Express.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  SYSTEM_PROMPT, MENSAJES_APERTURA, NOTA_ANUNCIO, BARRIOS_POR_SEDE, BARRIOS_LEJOS,
  ZONAS_FUERA_DE_CABA, ALIAS_ZONAS,
} from './prompt.js';
import { guardarResumen, buscarResumen } from './wsp-links.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const CONTACTO_WSP = '11 2394 7419';
export const FALLBACK_MSG = `Perdón, se me complicó procesar tu consulta. Escribinos directo al WhatsApp y te respondemos: ${CONTACTO_WSP}`;

// El bot cierra derivando al WhatsApp que atiende Demián, con el resumen de la
// charla ya escrito en el chat. El modelo no arma la URL: escribe [[WSP: resumen]]
// y la reemplazamos acá, porque el url-encoding a mano lo rompe seguido.
const WSP_TELEFONO = process.env.WSP_TELEFONO || '5491123947419';

const RESUMEN_POR_DEFECTO =
  'Hola! Vengo del Instagram de Futbol Queens y quiero coordinar una clase de prueba.';

const WSP_MARCA_RE = /\[\[\s*WSP\s*:\s*([\s\S]*?)\]\]/g;
// Sin /g a propósito: .test() sobre una regex global lleva estado entre llamadas
// (lastIndex) y devolvería false una de cada dos veces.
const TIENE_MARCA_WSP = /\[\[\s*WSP\s*:/;

// El destino final: abre el chat de WhatsApp con el texto ya escrito. Es el link
// al que redirige el short link, y el que mandamos tal cual si no hay dominio
// propio configurado.
export function linkWspLargo(resumen = '') {
  const texto = resumen.trim() || RESUMEN_POR_DEFECTO;
  return `https://wa.me/${WSP_TELEFONO}?text=${encodeURIComponent(texto)}`;
}

// Instagram no renderiza markdown ni acorta URLs: el link largo se ve como un
// bloque de %20 de veinte líneas. Con PUBLIC_BASE_URL definido mandamos en su
// lugar un /w/xxxxxxx propio, que server.js resuelve y redirige.
//
// Se lee en cada llamada, no al importar el módulo: el eval lo apaga en caliente
// para poder leer el resumen, que el link corto esconde.
export function linkWsp(resumen = '') {
  const texto = resumen.trim() || RESUMEN_POR_DEFECTO;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return linkWspLargo(texto);
  return `${base}/w/${guardarResumen(texto)}`;
}

export function insertarLinkWsp(texto) {
  return texto.replace(WSP_MARCA_RE, (_, resumen) => linkWsp(resumen));
}

// Inversa de insertarLinkWsp, para el historial. Si el modelo ve la URL corta
// en sus mensajes anteriores, a veces la vuelve a escribir con un id inventado
// en vez de emitir la marca (3 casos en la primera semana de septiembre 2026).
// Guardando la marca en el historial, nunca ve una URL propia. Una URL cuyo id
// no conocemos queda como está: no hay resumen que recuperar.
const LINK_CORTO_RE = /https?:\/\/\S+?\/w\/([A-Za-z0-9_-]{7,})/g;

export function ocultarLinkWsp(texto) {
  return texto.replace(LINK_CORTO_RE, (url, id) => {
    const resumen = buscarResumen(id);
    return resumen ? `[[WSP: ${resumen}]]` : url;
  });
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
  const globos = texto
    .split(/^\s*-{3,}\s*$/m)
    // El link va último: así la limpieza de markdown y de signos no le toca la URL.
    // ocultarLinkWsp va primero, como red de seguridad: si el modelo escribió una
    // URL corta válida en vez de la marca, la volvemos marca y se resuelve limpia.
    .map(ocultarLinkWsp)
    .map((crudo) => ({ crudo, texto: insertarLinkWsp(limpiarMarkdown(sinSignosDeApertura(crudo))) }))
    .filter((g) => g.texto);

  if (globos.length <= MAX_GLOBOS) return globos.map((g) => g.texto);

  // Recortar de más es normal y no pasa nada, salvo con el globo del link: ese
  // es la derivación entera. Si el modelo se pasa de globos y el link quedó
  // último, el corte se lo lleva en silencio y la familia nunca llega al
  // WhatsApp. Cuando eso pasa, lo rescatamos poniéndolo en el último lugar.
  const conLink = globos.findIndex((g) => TIENE_MARCA_WSP.test(g.crudo));
  const recortados = globos.slice(0, MAX_GLOBOS);
  if (conLink >= MAX_GLOBOS) {
    console.warn(`[bot] El link quedaba fuera del corte de ${MAX_GLOBOS} globos — lo rescato`);
    recortados[MAX_GLOBOS - 1] = globos[conLink];
  }
  return recortados.map((g) => g.texto);
}

// ─── Llamada al modelo ───────────────────────────────────────────────────────

const MODEL = process.env.BOT_MODEL || 'claude-sonnet-5';
const EFFORT = process.env.BOT_EFFORT || 'low';
// Si los clasificadores de seguridad rechazan un pedido, la API lo reintenta sola
// en otro modelo en vez de devolvernos la conversación cortada. Para este bot el
// riesgo de rechazo es prácticamente nulo, así que si la beta no está habilitada
// en la cuenta y la API devuelve 400, se apaga con BOT_FALLBACKS=false.
const FALLBACKS = (process.env.BOT_FALLBACKS || 'true') !== 'false';

export const BOT_CONFIG = { MODEL, EFFORT, MAX_GLOBOS, FALLBACKS };

// No todos los modelos aceptan `fallbacks`: si el que está configurado no lo
// soporta, la API tira 400 y el bot le contesta el mensaje de error a TODO el
// mundo. Pasó al cambiar de modelo con BOT_FALLBACKS=true. En vez de depender de
// que alguien se acuerde de tocar la variable, lo apagamos solos y seguimos.
let usarFallbacks = FALLBACKS;

async function crearMensaje(params) {
  // Miramos si ESTA llamada los mandó, no cómo quedó la flag: con varias
  // llamadas en paralelo, la primera que falla la apaga y las demás tienen que
  // poder reintentar igual.
  const losMande = usarFallbacks;
  try {
    return await client.beta.messages.create({
      ...params,
      ...(losMande ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    });
  } catch (err) {
    const noLoSoporta = err?.status === 400 && /fallbacks/i.test(err?.message || '');
    if (!losMande || !noLoSoporta) throw err;
    if (usarFallbacks) {
      console.warn(`[bot] ${params.model} no soporta fallbacks — los apago y reintento`);
      usarFallbacks = false;
    }
    return client.beta.messages.create(params);
  }
}

// ─── Triage del primer mensaje ───────────────────────────────────────────────
// La apertura sale por código sin que el modelo lea el mensaje (ver responder()),
// así que cualquier cosa que llegue al Instagram recibía "Somos una escuela de
// fútbol... De dónde son ustedes?": vendedores, fotógrafas, ligas, gente que busca
// trabajo. La agencia pidió (sep 2026) que a quien ofrece algo no se le conteste
// nada, que a quien busca trabajo se le pida el CV, y que la consulta por fútbol
// para adultas llegue al modelo, que ya sabe derivarla. Antes de la apertura
// clasificamos el primer mensaje con una llamada chica, sin historial y sin
// prompt de negocio. Si la llamada falla, la persona se trata como familia: es
// mejor contestarle de más a un vendedor que dejar muda a una mamá.

export const TRIAGE = {
  FAMILIA: 'FAMILIA', COMERCIAL: 'COMERCIAL', BUSCA_TRABAJO: 'BUSCA_TRABAJO',
  ADULTA: 'ADULTA', OTRO: 'OTRO',
};

// Sale por código, no del modelo: así es siempre exactamente este texto.
export const MSG_BUSCA_TRABAJO =
  'Gracias por escribirnos! Para sumarte al equipo mandanos tu CV a aguante@futbolqueens.com y lo vemos.';

// Por defecto usa el mismo modelo del bot. La llamada es de ~600 tokens de entrada
// y una palabra de salida, así que con un modelo chico (haiku) sale casi gratis.
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || MODEL;

const TRIAGE_PROMPT = `Clasificás el primer mensaje que alguien le manda por Instagram a Fútbol Queens, una escuela de fútbol para nenas y adolescentes de 4 a 17 años en Buenos Aires. Respondé con UNA sola palabra, sin explicar nada:

FAMILIA: una mamá, un papá o una familia preguntando por la escuela para una nena o adolescente (clases, sedes, horarios, precios, edades, clase de prueba), o un saludo, una pregunta corta o cualquier mensaje que podría ser el inicio de esa consulta ("hola", "info", "me interesa", "sí", una edad, un barrio).

ADULTA: alguien que pregunta por fútbol para mujeres adultas, para ella misma o para mayores de 18.

BUSCA_TRABAJO: alguien que se ofrece para trabajar en la escuela (profe, entrenadora, preparador físico, médico, enfermero, kinesiólogo, pasantía) o quiere mandar su CV.

COMERCIAL: alguien que ofrece o vende algo a la escuela: marketing, manejo de redes, anuncios, fotografía, video, creación de contenido, influencers, merchandising, indumentaria, camisetas, instrumentos, fumigación, sponsors, canje, un torneo, una liga o una copa a la que invitan a sumarse, un programa de streaming, un medio, o cualquier otra propuesta o servicio.

OTRO: no es una consulta por la escuela ni una oferta: opiniones, comentarios sobre un posteo, saludos de otro club o institución, mensajes de una persona que no es una familia, spam, cadenas, mensajes sin sentido.

Regla de oro: ante la duda, FAMILIA. Solo marcá COMERCIAL, BUSCA_TRABAJO u OTRO cuando el mensaje lo dice con claridad. Un mensaje corto, ambiguo o mal escrito es FAMILIA.

Si te pasan mensajes anteriores de la misma persona que quedaron sin respuesta, usalos como contexto: un "hola?", "gracias" o "vieron mi propuesta?" después de una oferta sigue siendo COMERCIAL.`;

export async function clasificarPrimerMensaje(texto, { anteriores = [] } = {}) {
  const contenido = anteriores.length
    ? `Mensajes anteriores de la misma persona, sin respuesta:\n${anteriores.map((t) => `» ${t}`).join('\n')}\n\nMensaje nuevo:\n${texto}`
    : texto;
  try {
    const r = await client.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 10,
      system: TRIAGE_PROMPT,
      messages: [{ role: 'user', content: contenido }],
    });
    const salida = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toUpperCase();
    const etiqueta = Object.values(TRIAGE).find((e) => salida.includes(e));
    if (!etiqueta) console.warn(`[triage] Salida rara "${salida}" — lo trato como FAMILIA`);
    return etiqueta || TRIAGE.FAMILIA;
  } catch (err) {
    console.error('[triage] Error clasificando — lo trato como FAMILIA:', err.message);
    return TRIAGE.FAMILIA;
  }
}

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
export async function runBot(messages, { channel = 'web', origen = null } = {}) {
  const { fecha, hora } = ahora();
  const contexto = origen === 'anuncio' ? NOTA_ANUNCIO : '';

  // El prompt estable va primero y con cache_control: son ~5k tokens que antes se
  // mandaban enteros en cada mensaje, y así las lecturas salen a 0,1x del precio.
  // Todo lo que cambia (la hora, el contexto de anuncio) va DESPUÉS del breakpoint:
  // si fuera antes —como estaba— el prefijo cambiaría cada hora y el cache no
  // pegaría nunca.
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: `${contexto}Hoy es ${fecha} y son las ${String(hora).padStart(2, '0')} hs. ${notaHorarioWsp(hora)}`,
    },
  ];

  const response = await crearMensaje({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages,
    output_config: { effort: EFFORT },
  });

  // Con el cache andando, la primera llamada escribe y las siguientes leen a ~0,1x.
  // Si cache_read queda en 0 llamada tras llamada, algo se volvió a meter arriba del
  // breakpoint (una fecha, una hora, un id) y hay que sacarlo de ahí.
  if (process.env.BOT_DEBUG_CACHE === 'true') {
    const u = response.usage;
    console.log(`[cache:${channel}] write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} sin_cachear=${u.input_tokens}`);
  }

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

// Los nombres se meten crudos adentro de una regex, así que hay que escaparlos:
// "José C. Paz" trae un punto, que sin escapar matchea cualquier carácter.
const escaparRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ZONAS_CONOCIDAS = [
  ...new Set([
    ...Object.values(BARRIOS_POR_SEDE).flatMap((s) => s.barrios),
    ...Object.keys(BARRIOS_POR_SEDE),
    ...Object.keys(BARRIOS_LEJOS),
    ...ZONAS_FUERA_DE_CABA,
    ...ALIAS_ZONAS,
    'caba', 'capital', 'capital federal',
  ]),
].map((z) => escaparRegex(sinAcentos(z)));

// Detecta si el mensaje nombra un barrio, un partido del conurbano o una sede. Es a
// propósito conservador: ante la duda decimos que no y la apertura pregunta la zona,
// que es el peor caso tolerable. Lo intolerable es preguntar algo que ya nos dijeron.
export function mencionaZona(texto) {
  const t = sinAcentos(texto);
  return ZONAS_CONOCIDAS.some((zona) => new RegExp(`(^|[^a-z])${zona}([^a-z]|$)`).test(t));
}

// ─── Leads que vienen del anuncio ────────────────────────────────────────────

// El anuncio de Instagram pregunta "Tu hija tiene entre 4 y 17 años?", así que el
// primer mensaje del lead es la respuesta: un "sí" pelado o la edad sola. Meta manda
// un referral en el webhook cuando la charla arranca desde un anuncio, pero no
// siempre llega, así que además lo deducimos de la forma del mensaje.

const AFIRMACIONES = ['si', 'sisi', 'sip', 'simon', 'dale', 'claro', 'obvio', 'correcto',
  'exacto', 'asi es', 'ok', 'oka', 'okey', 'yes', 'siii', 'sii'];

const NUMEROS_EN_LETRAS = {
  tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
};

const soloLetrasYNumeros = (t) => sinAcentos(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// "sí", "dale", "5", "tiene 5", "cinco años": todos son respuestas al anuncio y
// ninguno tiene sentido como primer mensaje espontáneo a una escuela de fútbol.
export function esRespuestaDeAnuncio(texto) {
  const t = soloLetrasYNumeros(texto);
  if (!t) return false;
  if (AFIRMACIONES.includes(t.replace(/\s/g, ''))) return true;

  const palabras = t.split(' ');
  if (palabras.length > 4) return false;
  const edad = palabras.map((p) => (NUMEROS_EN_LETRAS[p] ?? Number(p)))
    .find((n) => Number.isInteger(n) && n >= 3 && n <= 17);
  return edad !== undefined;
}

// `clasificacion` es la etiqueta del triage (server.js la calcula para Instagram;
// el widget web no la manda). Solo cambia algo cuando es ADULTA.
export async function responder(
  messages,
  { channel = 'web', esPrimeraRespuesta = false, origen = null, clasificacion = null } = {},
) {
  const primerMensaje = messages.find((m) => m.role === 'user')?.content ?? '';
  const deAnuncio = origen === 'anuncio'
    || (esPrimeraRespuesta && esRespuestaDeAnuncio(primerMensaje));

  if (!esPrimeraRespuesta) {
    return runBot(messages, { channel, origen: deAnuncio ? 'anuncio' : null });
  }

  // Viene del anuncio: la presentación sobra, ya la vio ahí. Contesta el modelo,
  // que tiene que reconocer lo que dijo y seguir desde ese punto.
  if (deAnuncio) return runBot(messages, { channel, origen: 'anuncio' });

  // Todavía no sabemos de dónde son: la apertura ya se los pregunta y con eso alcanza.
  // Excepción: si pregunta por fútbol para adultas, la zona no importa. Antes esa
  // consulta recibía la apertura y nunca llegaba al modelo, que es el que sabe
  // derivarla a De Taquito Femenino o La Sede Colegiales.
  if (clasificacion !== TRIAGE.ADULTA && !mencionaZona(primerMensaje)) return [...MENSAJES_APERTURA];

  // Ya nos dijeron la zona (o es una adulta): sacamos la pregunta de la apertura,
  // dejamos la presentación y que siga el modelo. Le recortamos un globo para no abrumar.
  const respuesta = await runBot(messages, { channel });
  return [MENSAJES_APERTURA[0], ...respuesta.slice(0, Math.max(1, MAX_GLOBOS - 1))];
}
