import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import {
  responder, FALLBACK_MSG, BOT_CONFIG, linkWspLargo, ocultarLinkWsp,
  clasificarPrimerMensaje, esRespuestaDeAnuncio, TRIAGE, MSG_BUSCA_TRABAJO,
} from './bot.js';
import { buscarResumen } from './wsp-links.js';
import { crearAgrupador } from './agrupar.js';

const app = express();

app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowed);
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Guardamos el body crudo para validar la firma de los webhooks de Meta
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.static('public'));

// ─── Short link de derivación al WhatsApp ────────────────────────────────────
// El bot manda /w/xxxxxxx en vez de la URL de WhatsApp con el resumen encodeado.
// Si el id no está (redeploy que se llevó el disco), redirigimos igual con el
// mensaje por defecto: la familia llega al chat, solo que sin el resumen escrito.

// Cuando el bot manda un link, Instagram lo visita para armar la tarjeta de
// vista previa: cuatro pedidos en los primeros segundos, ninguno de una persona
// (76 de 84 visitas en la primera semana de septiembre 2026). Los distinguimos
// por User-Agent para que "Abren el link" mida gente de verdad.
const CRAWLER_UA_RE = /facebookexternalhit|Facebot|facebookcatalog|meta-externalagent/i;

app.get('/w/:id', (req, res) => {
  const resumen = buscarResumen(req.params.id);
  const esCrawler = CRAWLER_UA_RE.test(req.get('user-agent') || '');
  if (esCrawler) {
    console.log(`[w] Vista previa de Meta para ${req.params.id}${resumen ? '' : ' (id desconocido)'}`);
  } else if (resumen) {
    console.log(`[w] Abren el link ${req.params.id}`);
  } else {
    console.warn(`[w] Id desconocido ${req.params.id} — mando el mensaje por defecto`);
  }
  res.set('Cache-Control', 'no-store'); // el id es de un solo lead, no se cachea
  res.redirect(302, linkWspLargo(resumen || ''));
});

// ─── Chat endpoint (widget web) ──────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Se requiere el campo "messages" (array no vacío).' });
  }

  const esPrimeraRespuesta = !messages.some((m) => m.role === 'assistant');

  const timeoutId = setTimeout(() => {
    if (!res.headersSent) res.json({ messages: [FALLBACK_MSG] });
  }, 45000);

  try {
    // El historial llega del navegador con los links ya resueltos: se los
    // devolvemos al modelo como marca [[WSP: ...]] para que no vea URLs propias.
    const historial = messages.map((m) =>
      m.role === 'assistant' && typeof m.content === 'string'
        ? { ...m, content: ocultarLinkWsp(m.content) }
        : m
    );
    const globos = await responder(historial, { channel: 'web', esPrimeraRespuesta });
    clearTimeout(timeoutId);
    if (res.headersSent) return;
    console.log(`[/chat] Respondiendo con ${globos.length} mensajes`);
    res.json({ messages: globos });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error en /chat:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ─── Instagram: memoria de conversaciones (por usuario) ──────────────────────
// En memoria: simple y suficiente para empezar. Se reinicia si Railway redeploya.
// OJO: con el TTL en 48 hs un redeploy ya no se lleva puestas un par de charlas,
// se lleva dos días. Para continuidad de verdad hay que persistir — el molde está
// en wsp-links.js (escritura best-effort a disco + cargar() al arrancar) y pide un
// volumen montado en Railway, el mismo que ya conviene montar para WSP_LINKS_FILE.

const igSessions = new Map(); // senderId -> { messages, updatedAt, humanUntil, lastFallbackAt }
// 48 hs: la gente pregunta, lo charla en casa y contesta al otro día. Con 6 hs
// esa respuesta caía en una sesión nueva y el bot volvía a saludar y a preguntar
// todo de cero. Configurable por si hay que ajustarlo sin deploy.
const SESSION_TTL_MS = Number(process.env.IG_SESSION_TTL_HS ?? 48) * 60 * 60 * 1000;
const seenMids = new Set();                   // dedupe de reintentos de Meta
const ownMids = new Set();                    // ids de mensajes que mandó el bot
const HUMAN_HANDOFF_MS = 2 * 60 * 60 * 1000;  // si alguien contesta a mano, el bot se calla 2hs
// Ventana durante la cual un echo que llega para este destinatario se considera
// nuestro aunque su mid todavía no esté en ownMids. Meta a veces entrega el echo
// ANTES de que la llamada de envío devuelva el message_id (16/9/2026, tres charlas
// en dos días) y el bot se confundía a sí mismo con alguien del equipo: pausaba
// la charla 2 hs y cortaba el resto de la secuencia.
const OWN_SEND_GRACE_MS = 15 * 1000;
const FALLBACK_COOLDOWN_MS = 15 * 60 * 1000;  // no repetir el aviso de error seguido

// La automatización de Meta que contesta por DM a quien comenta "info" en un
// posteo sale como echo de la cuenta, igual que una respuesta del equipo. Sin
// esto el bot pausaba 2 hs justo cuando la persona contestaba ese DM (28/9/2026).
// AUTO_DM_TEXTOS: fragmentos del texto de esas automatizaciones, separados por "|".
const normalizarTexto = (t) => String(t || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const AUTO_DM_TEXTOS = (process.env.AUTO_DM_TEXTOS || 'escuela de futbol para ninas y adolescentes')
  .split('|').map(normalizarTexto).filter(Boolean);
const esDmAutomatico = (texto) => {
  const t = normalizarTexto(texto);
  return !!t && AUTO_DM_TEXTOS.some((f) => t.includes(f));
};

function getIgSession(senderId) {
  const now = Date.now();
  let s = igSessions.get(senderId);
  if (!s || now - s.updatedAt > SESSION_TTL_MS) {
    s = {
      messages: [], updatedAt: now, humanUntil: 0, lastFallbackAt: 0, origen: null,
      // El triage marcó que no es una familia: no contestamos y guardamos lo que
      // escribió para volver a clasificar con contexto si sigue escribiendo.
      silenciada: false, silenciados: [],
    };
    igSessions.set(senderId, s);
  } else {
    // La charla sigue viva mientras alguien escriba, aunque el bot no conteste
    // (handoff humano, fuera de ventana, error). Sin esto la sesión se vence a
    // las 48 hs de la última respuesta del BOT, no del último mensaje.
    s.updatedAt = now;
  }
  return s;
}

// Las sesiones vencidas solo se descartaban cuando ese mismo usuario volvía a
// escribir: las que no vuelven quedaban en memoria para siempre.
setInterval(() => {
  const ahora = Date.now();
  let borradas = 0;
  for (const [id, s] of igSessions) {
    if (ahora - s.updatedAt > SESSION_TTL_MS) { igSessions.delete(id); borradas++; }
  }
  if (borradas) console.log(`[ig] Limpieza: ${borradas} sesiones vencidas (quedan ${igSessions.size})`);
}, 60 * 60 * 1000).unref();

// ─── Ventana horaria del bot en Instagram ────────────────────────────────────
// Por defecto contesta siempre. Si se definen IG_BOT_START_HOUR y IG_BOT_END_HOUR,
// solo contesta dentro de esa franja (sirve para que el bot cubra la noche y una
// persona del equipo atienda de día).

const IG_TZ = process.env.IG_TZ || 'America/Argentina/Buenos_Aires';

function horaLocal() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IG_TZ, hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
}

function isBotActiveNow() {
  if ((process.env.IG_ENABLED || 'true') === 'false') return false;
  const start = process.env.IG_BOT_START_HOUR;
  const end = process.env.IG_BOT_END_HOUR;
  if (start === undefined || end === undefined) return true; // sin ventana: siempre activo
  const h = horaLocal();
  return Number(start) < Number(end)
    ? (h >= Number(start) && h < Number(end))
    : (h >= Number(start) || h < Number(end));
}

// ─── Envío por Instagram ─────────────────────────────────────────────────────

// Instagram corta los mensajes ~1000 caracteres: partimos por líneas.
function chunkText(text, max = 950) {
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && (cur + '\n' + line).length > max) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + '\n' + line : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// La app usa Instagram API con Instagram Login: los tokens arrancan con IGAA y
// van contra graph.instagram.com. graph.facebook.com no los sabe leer y responde
// "Cannot parse access token" (code 190), que parece un token vencido y no lo es.
async function igSend(recipientId, message) {
  const base = process.env.IG_GRAPH_BASE || 'https://graph.instagram.com/v21.0';
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) { console.error('[ig] Falta IG_ACCESS_TOKEN — no puedo responder'); return; }

  // Antes del fetch, no después: el echo puede llegar antes que la respuesta.
  const session = getIgSession(recipientId);
  session.sendingUntil = Date.now() + OWN_SEND_GRACE_MS;
  if (message.text) session.lastSentText = message.text;

  const res = await fetch(`${base}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message }),
  });
  if (!res.ok) {
    console.error('[ig] Error enviando mensaje:', res.status, await res.text());
  } else {
    const data = await res.json().catch(() => null);
    if (data?.message_id) {
      ownMids.add(data.message_id);
      if (ownMids.size > 1000) ownMids.clear();
    }
  }
}

// ─── Historial desde Instagram ───────────────────────────────────────────────
// Las sesiones viven en RAM: a las 48 hs sin mensajes o con un deploy se pierden y
// el bot le volvía a mandar la apertura a alguien que ya había hablado con nosotros
// (24/9/2026: "Yo ya averigué con ustedes..."). Instagram guarda la charla entera,
// incluidas las respuestas manuales del equipo: cuando la sesión está vacía la
// traemos de ahí y el bot sigue desde donde quedó. Falla abierta: ante cualquier
// error devuelve vacío y el bot arranca de cero como antes.
const IG_HISTORIAL_MSGS = Number(process.env.IG_HISTORIAL_MSGS ?? 20);
const IG_HISTORIAL_DIAS = Number(process.env.IG_HISTORIAL_DIAS ?? 60);

async function cargarHistorialIg(senderId, textosNuevos) {
  const vacio = { historial: [], sinResponder: [] };
  const base = process.env.IG_GRAPH_BASE || 'https://graph.instagram.com/v21.0';
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return vacio;
  try {
    const qs = new URLSearchParams({
      platform: 'instagram',
      user_id: senderId,
      fields: `messages.limit(${IG_HISTORIAL_MSGS}){created_time,from,message}`,
      access_token: token,
    });
    const res = await fetch(`${base}/me/conversations?${qs}`);
    if (!res.ok) {
      console.warn(`[historial] ${senderId}: no pude traerlo (${res.status}) ${(await res.text()).slice(0, 300)}`);
      return vacio;
    }
    const data = await res.json();
    const msgs = (data?.data?.[0]?.messages?.data || [])
      .filter((m) => m.message)   // stickers, reacciones, historias: afuera
      .reverse();                 // Meta los da del más nuevo al más viejo

    // Los mensajes que estamos por contestar ya figuran en Instagram: los sacamos
    // del final para no mandárselos dos veces al modelo.
    const pendientes = [...textosNuevos];
    while (msgs.length && pendientes.length
      && msgs.at(-1).from?.id === senderId && msgs.at(-1).message === pendientes.at(-1)) {
      msgs.pop();
      pendientes.pop();
    }

    // Charla muy vieja: mejor arrancar de cero.
    const ultimo = msgs.at(-1);
    if (!ultimo || Date.now() - Date.parse(ultimo.created_time) > IG_HISTORIAL_DIAS * 864e5) return vacio;

    // Lo que no mandó el usuario lo mandamos nosotros (el bot o alguien del equipo
    // a mano). Unimos los seguidos del mismo lado, como se guardan en la sesión.
    const historial = [];
    for (const m of msgs) {
      const role = m.from?.id === senderId ? 'user' : 'assistant';
      const content = role === 'assistant' ? ocultarLinkWsp(m.message) : m.message;
      const prev = historial.at(-1);
      if (prev?.role === role) prev.content += `\n${content}`;
      else historial.push({ role, content });
    }
    while (historial[0]?.role === 'assistant') historial.shift(); // arranca por user

    // Si lo último es del usuario (escribió y nadie le contestó), no lo perdemos:
    // se suma al turno nuevo para que el modelo lo lea junto.
    const sinResponder = historial.at(-1)?.role === 'user' ? [historial.pop().content] : [];

    if (!historial.length) return vacio;
    console.log(`[historial] ${senderId}: retomo con ${historial.length} turnos (último mensaje ${ultimo.created_time})`);
    return { historial, sinResponder };
  } catch (err) {
    console.warn(`[historial] ${senderId}: ${err.message}`);
    return vacio;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Ritmo de envío ──────────────────────────────────────────────────────────
// Meta penaliza las ráfagas de mensajes automáticos, y además el guion pide que
// los globos salgan de a uno como los escribiría una persona. Espaciamos cada
// envío con una pausa aleatoria (el jitter importa: una cadencia exacta y
// constante es más fácil de detectar como bot que una variable) y mostramos
// "escribiendo…" para que la espera se vea natural.
const IG_MSG_DELAY_MS = Number(process.env.IG_MSG_DELAY_MS ?? 2500);
const IG_MSG_JITTER_MS = Number(process.env.IG_MSG_JITTER_MS ?? 900);
const IG_TYPING = (process.env.IG_TYPING || 'true') !== 'false';

function humanDelay() {
  const jitter = (Math.random() * 2 - 1) * IG_MSG_JITTER_MS;
  return Math.max(500, Math.round(IG_MSG_DELAY_MS + jitter));
}

async function igSendAction(recipientId, action) {
  if (!IG_TYPING) return;
  const base = process.env.IG_GRAPH_BASE || 'https://graph.instagram.com/v21.0';
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${base}/me/messages?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, sender_action: action }),
    });
    // No es crítico: si falla seguimos enviando, solo perdemos el indicador
    if (!res.ok) console.warn('[ig] sender_action falló:', res.status);
  } catch (err) {
    console.warn('[ig] sender_action error:', err.message);
  }
}

async function igSendSequence(recipientId, globos) {
  const session = igSessions.get(recipientId);
  for (const [i, texto] of globos.entries()) {
    // La secuencia dura varios segundos: si alguien del equipo contesta a mano
    // en el medio, cortamos acá en vez de seguir escribiendo encima.
    if (session?.humanUntil && Date.now() < session.humanUntil) {
      console.log(`[ig] Handoff humano durante el envío — corto (quedaban ${globos.length - i})`);
      return;
    }
    await igSendAction(recipientId, 'typing_on');
    // El primero sale antes: el cliente ya esperó lo que tardó el modelo
    await sleep(i === 0 ? Math.min(900, humanDelay()) : humanDelay());
    for (const chunk of chunkText(texto)) {
      try {
        await igSend(recipientId, { text: chunk });
      } catch (err) {
        console.error('[ig] Error enviando:', err.message);
      }
    }
  }
}

// ─── Agrupado de mensajes por persona ────────────────────────────────────────
// La gente escribe como habla: "16" / "Años", o la pregunta partida en dos o tres
// mensajes con segundos de diferencia. Cada mensaje llega en su propio webhook (o
// varios en el mismo), y si arrancamos una respuesta por cada uno el modelo corre
// en paralelo sobre casi el mismo historial y contesta lo mismo dos o tres veces
// (28/9/2026, "Ah no llego x la escuela..." y "Un bajon" a 8 s dieron dos
// respuestas). agrupar.js espera IG_DEBOUNCE_MS desde el último mensaje (tope
// IG_DEBOUNCE_MAX_MS desde el primero), junta los textos y corre handleIgMessage
// una sola vez; mientras responde, lo que llega va al turno siguiente.
const IG_DEBOUNCE_MS = Number(process.env.IG_DEBOUNCE_MS ?? 20000);
const IG_DEBOUNCE_MAX_MS = Number(process.env.IG_DEBOUNCE_MAX_MS ?? 60000);

const igAgrupador = crearAgrupador({
  esperaMs: IG_DEBOUNCE_MS,
  maxMs: IG_DEBOUNCE_MAX_MS,
  procesar: (senderId, text, { textos }) => handleIgMessage(senderId, text, textos),
});

function encolarIgMessage(senderId, text) {
  const enEspera = igAgrupador.agregar(senderId, text);
  // Mostramos "escribiendo…" ya: si no, durante la espera parece que no lo leímos.
  if (enEspera === 1) igSendAction(senderId, 'typing_on');
}

// Corre una vez por turno, con todos los mensajes de la espera ya juntos. El
// agrupador garantiza que no hay dos turnos en paralelo para la misma persona.
async function handleIgMessage(senderId, text, textos = [text]) {
  const session = getIgSession(senderId);

  // Durante la espera pudo contestar alguien del equipo o cerrarse la ventana
  // horaria: lo rechequeamos acá, no alcanza con el chequeo de cuando entró.
  if (session.humanUntil && Date.now() < session.humanUntil) {
    console.log(`[webhook] Charla con ${senderId} pausada por handoff humano`);
    return;
  }
  if (!isBotActiveNow()) {
    console.log(`[webhook] Fuera de la ventana del bot (hora ${horaLocal()}) — no contesto a ${senderId}`);
    return;
  }

  // Sesión vacía (primera vez, más de 48 hs sin hablar o hubo deploy): si ya
  // hablamos antes con esta persona, retomamos la charla desde Instagram. Con
  // historial, esPrimeraRespuesta da false y no corren ni el triage ni la apertura.
  if (!session.messages.length && !session.historialCargado) {
    session.historialCargado = true; // una sola vez por sesión, aunque venga vacío
    const { historial, sinResponder } = await cargarHistorialIg(senderId, textos);
    if (historial.length) {
      session.messages = historial;
      // Lo que quedó sin responder en Instagram se suma adelante del turno nuevo.
      text = [...sinResponder, text].join('\n');
    }
  }

  console.log(`[ig] Procesando mensaje de ${senderId}: "${text}"${textos.length > 1 ? ` (${textos.length} mensajes agrupados)` : ''}${session.origen === 'anuncio' ? ' (viene del anuncio)' : ''}`);

  const esPrimeraRespuesta = !session.messages.some((m) => m.role === 'assistant');
  // El triage corre una sola vez, sobre el texto ya junto.
  const clasificacion = await clasificarIg(senderId, session, text, esPrimeraRespuesta);
  if (clasificacion === TRIAGE.COMERCIAL || clasificacion === TRIAGE.OTRO) {
    silenciarIg(senderId, session, text, clasificacion);
    return;
  }
  if (session.silenciada) {
    session.silenciada = false;
    session.silenciados = [];
    console.log(`[triage] Levanto el silencio de ${senderId}: ahora parece una familia`);
  }
  if (clasificacion === TRIAGE.BUSCA_TRABAJO) {
    await responderBuscaTrabajo(senderId, session, text);
  } else {
    await responderIg(senderId, session, text, esPrimeraRespuesta, clasificacion);
  }
}

// ─── Triage: quién nos escribe ───────────────────────────────────────────────
// Solo corre en el primer mensaje de la charla, o en cada mensaje de una charla
// que ya está silenciada (por si el filtro se equivocó y era una familia). No corre
// para los que vienen del anuncio: esos contestan "sí" o una edad, y son familia
// por construcción.

async function clasificarIg(senderId, session, text, esPrimeraRespuesta) {
  if (!esPrimeraRespuesta && !session.silenciada) return null;
  const deAnuncio = session.origen === 'anuncio' || (esPrimeraRespuesta && esRespuestaDeAnuncio(text));
  if (deAnuncio) return null;
  const etiqueta = await clasificarPrimerMensaje(text, { anteriores: session.silenciados });
  console.log(`[triage] ${senderId}: ${etiqueta}${session.silenciada ? ' (charla silenciada)' : ''}`);
  return etiqueta;
}

// Vendedores, ligas, sponsors, opiniones: no contestamos nada. El mensaje queda
// sin leer en la bandeja y lo ve el equipo. La charla queda silenciada mientras
// dure la sesión; cada mensaje nuevo se vuelve a clasificar con los anteriores
// como contexto, así un "hola?" del vendedor sigue en silencio y una familia que
// fue mal clasificada arranca con la apertura normal.
function silenciarIg(senderId, session, text, clasificacion) {
  session.silenciada = true;
  session.silenciados.push(text);
  if (session.silenciados.length > 6) session.silenciados = session.silenciados.slice(-6);
  session.updatedAt = Date.now();
  console.log(`[triage] Sin respuesta para ${senderId} (${clasificacion}) — queda para el equipo`);
}

// Busca trabajo: un solo mensaje fijo pidiendo el CV y nada más. No lo guardamos
// en el historial a propósito: si después resulta ser una familia, arranca de cero
// con la apertura en vez de seguir una charla sobre CVs.
async function responderBuscaTrabajo(senderId, session, text) {
  session.silenciada = true;
  session.silenciados = [text, `(le contestamos: ${MSG_BUSCA_TRABAJO})`];
  session.updatedAt = Date.now();
  console.log(`[triage] ${senderId} busca trabajo — le pido el CV y no sigo la charla`);
  await igSendSequence(senderId, [MSG_BUSCA_TRABAJO]);
}

async function responderIg(senderId, session, text, esPrimeraRespuesta, clasificacion = null) {
  session.messages.push({ role: 'user', content: text });
  // El historial se remanda entero en cada turno, así que cada mensaje que
  // guardamos de más se paga en todos los turnos que siguen. 20 cubre de sobra
  // una conversación de derivación.
  if (session.messages.length > 20) session.messages = session.messages.slice(-20);

  let globos;
  try {
    globos = await responder(session.messages, {
      channel: 'instagram', esPrimeraRespuesta, origen: session.origen, clasificacion,
    });
  } catch (err) {
    console.error('[ig] responder error:', err.message);
    const now = Date.now();
    if (now - session.lastFallbackAt < FALLBACK_COOLDOWN_MS) {
      // Ya le avisamos hace poco — no lo repetimos por cada mensaje nuevo
      console.log(`[ig] Falla repetida con ${senderId} — no reenvío el aviso (cooldown)`);
      session.messages.pop(); // no rompemos la alternancia user/assistant
      return;
    }
    session.lastFallbackAt = now;
    globos = [FALLBACK_MSG];
  }

  // En el historial va la marca [[WSP: ...]], no la URL corta: si el modelo ve
  // la URL en sus mensajes anteriores, a veces la reescribe con un id inventado
  // en vez de emitir la marca (3 casos en la primera semana de septiembre 2026).
  session.messages.push({ role: 'assistant', content: ocultarLinkWsp(globos.join('\n')) });
  session.updatedAt = Date.now();

  console.log(`[ig] Enviando ${globos.length} mensajes (pausa ~${IG_MSG_DELAY_MS}ms ±${IG_MSG_JITTER_MS}ms)`);
  await igSendSequence(senderId, globos);
}

// Cuando la charla arranca desde un anuncio, Meta adjunta un referral con source
// "ADS" y el ad_id. Según el tipo de anuncio viene colgado del evento o del mensaje,
// así que miramos los dos lugares. Si Meta no lo manda, bot.js igual deduce el
// origen por la forma del primer mensaje ("sí" pelado, o una edad sola).
function vieneDeAnuncio(event) {
  const refs = [event?.referral, event?.message?.referral, event?.postback?.referral];
  return refs.some((r) => r && (
    String(r.source || '').toUpperCase() === 'ADS' || r.ad_id || r.ads_context_data
  ));
}

// Texto sin ninguna letra ni número: emojis, puntuación, espacios.
const SIN_LETRAS_RE = /^[^\p{L}\p{N}]*$/u;

// Valida que el webhook venga realmente de Meta (firma HMAC con el App Secret)
function verifySignature(req) {
  const secret = process.env.IG_APP_SECRET;
  if (!secret) return true; // si no está configurado no bloqueamos (útil para probar)
  const sig = req.get('x-hub-signature-256');
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Webhook de Instagram ────────────────────────────────────────────────────

// Verificación inicial que hace Meta al configurar el webhook (handshake)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.IG_VERIFY_TOKEN) {
    console.log('[webhook] Verificación OK');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] Verificación fallida');
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200); // respondemos rápido para que Meta no reintente

  try {
    if (!verifySignature(req)) { console.warn('[webhook] Firma inválida — descartado'); return; }

    const body = req.body;
    if (!body || body.object !== 'instagram') return;

    for (const entry of body.entry || []) {
      // Instagram manda los mensajes en 2 formatos posibles:
      //  - entry.messaging[]     → DMs reales
      //  - entry.changes[].value → casos de uso / botón de prueba del dashboard
      const events = [
        ...(entry.messaging || []),
        ...(entry.changes || []).filter((c) => c.field === 'messages').map((c) => c.value),
      ];

      for (const event of events) {
        const senderId = event?.sender?.id;
        const recipientId = event?.recipient?.id;
        // El referral puede llegar en un evento propio, sin mensaje. Dejamos marcada
        // la sesión para que el mensaje que venga después ya se trate como del anuncio.
        if (senderId && vieneDeAnuncio(event)) getIgSession(senderId).origen = 'anuncio';

        const msg = event?.message;
        if (!msg) continue;

        if (msg.is_echo) {
          // Salió un mensaje desde la cuenta hacia el cliente. Si el mid no es
          // nuestro, alguien del equipo contestó a mano: pausamos al bot en esa
          // charla para que no se pisen las respuestas.
          if (msg.mid && ownMids.has(msg.mid)) continue;
          if (recipientId) {
            const session = getIgSession(recipientId);
            // Echo de un envío nuestro que todavía no devolvió el message_id:
            // hay un envío en curso para este destinatario, o el texto es
            // exactamente el último que le mandamos.
            const enviando = session.sendingUntil && Date.now() < session.sendingUntil;
            const mismoTexto = !!msg.text && !!session.lastSentText && msg.text.trim() === session.lastSentText.trim();
            if (enviando || mismoTexto) {
              if (msg.mid) ownMids.add(msg.mid);
              console.log(`[webhook] Echo propio para ${recipientId} (llegó antes que el message_id) — lo ignoro`);
              continue;
            }
            // Evento crudo, para ver si Meta manda algún campo (app_id, etc.)
            // que identifique la automatización sin depender del texto.
            console.log(`[echo-raw] ${JSON.stringify(event)}`);
            if (esDmAutomatico(msg.text)) {
              console.log(`[handoff] Echo de automatización de Meta para ${recipientId}, no pauso`);
              continue;
            }
            session.humanUntil = Date.now() + HUMAN_HANDOFF_MS;
            // Lo que estaba esperando para salir ya no sale: contesta la persona.
            // (Si ya hay una respuesta en curso, igSendSequence la corta sola.)
            igAgrupador.cancelar(recipientId, 'respuesta manual');
            console.log(`[webhook] Respuesta manual detectada para ${recipientId} — pauso ${HUMAN_HANDOFF_MS / 60000} min`);
          }
          continue;
        }

        if (!senderId) continue;
        if (!msg.text) continue; // por ahora solo texto

        // Reacción a una historia: llega como mensaje con el emoji de texto y
        // reply_to.story. No es una consulta, y contestarle la apertura a alguien
        // que tocó un corazón queda raro. Una respuesta a la historia con texto de
        // verdad ("tienen sede en Núñez?") sí entra, esa es un lead.
        if (msg.reply_to?.story && SIN_LETRAS_RE.test(msg.text)) {
          console.log(`[webhook] Reacción a historia de ${senderId} ("${msg.text}") — no contesto`);
          continue;
        }
        // Mientras confirmamos la forma exacta del payload, dejamos rastro de las
        // respuestas a historias que sí pasan.
        if (msg.reply_to) console.log(`[webhook] reply_to de ${senderId}: ${JSON.stringify(msg.reply_to)}`);

        if (msg.mid) {
          if (seenMids.has(msg.mid)) continue;
          seenMids.add(msg.mid);
          if (seenMids.size > 1000) seenMids.clear();
        }

        if (!isBotActiveNow()) {
          console.log(`[webhook] Fuera de la ventana del bot (hora ${horaLocal()}) — no contesto`);
          continue;
        }

        const session = getIgSession(senderId);
        if (session.humanUntil && Date.now() < session.humanUntil) {
          console.log(`[webhook] Charla con ${senderId} pausada por handoff humano`);
          continue;
        }

        if (vieneDeAnuncio(event)) session.origen = 'anuncio';
        encolarIgMessage(senderId, msg.text);
      }
    }
  } catch (err) {
    console.error('[webhook] Error:', err.message);
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Fútbol Queens Bot corriendo en http://localhost:${PORT}`);
  console.log(`[bot] Modelo ${BOT_CONFIG.MODEL} · effort ${BOT_CONFIG.EFFORT} · máx ${BOT_CONFIG.MAX_GLOBOS} globos`);
  const ventana = process.env.IG_BOT_START_HOUR !== undefined && process.env.IG_BOT_END_HOUR !== undefined
    ? `${process.env.IG_BOT_START_HOUR}:00–${process.env.IG_BOT_END_HOUR}:00 (${IG_TZ})`
    : 'siempre activo';
  console.log(`[ig] Canal Instagram: ${(process.env.IG_ENABLED || 'true') === 'false' ? 'APAGADO' : ventana}`);
  console.log(`[ig] Agrupo mensajes: espera ${IG_DEBOUNCE_MS / 1000} s desde el último, tope ${IG_DEBOUNCE_MAX_MS / 1000} s desde el primero`);
  console.log(`[wsp] Link de derivación: ${process.env.PUBLIC_BASE_URL
    ? `corto (${process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/w/...)`
    : 'LARGO — definí PUBLIC_BASE_URL para acortarlo'}`);
});
