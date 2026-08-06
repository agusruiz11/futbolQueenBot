import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { responder, FALLBACK_MSG, BOT_CONFIG } from './bot.js';

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
    const globos = await responder(messages, { channel: 'web', esPrimeraRespuesta });
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
// Migrar a una DB si se necesita persistencia real.

const igSessions = new Map(); // senderId -> { messages, updatedAt, humanUntil, lastFallbackAt }
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;   // 6 horas de inactividad
const seenMids = new Set();                   // dedupe de reintentos de Meta
const ownMids = new Set();                    // ids de mensajes que mandó el bot
const HUMAN_HANDOFF_MS = 2 * 60 * 60 * 1000;  // si alguien contesta a mano, el bot se calla 2hs
const FALLBACK_COOLDOWN_MS = 15 * 60 * 1000;  // no repetir el aviso de error seguido

function getIgSession(senderId) {
  const now = Date.now();
  let s = igSessions.get(senderId);
  if (!s || now - s.updatedAt > SESSION_TTL_MS) {
    s = { messages: [], updatedAt: now, humanUntil: 0, lastFallbackAt: 0, origen: null };
    igSessions.set(senderId, s);
  }
  return s;
}

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

async function handleIgMessage(senderId, text, { deAnuncio = false } = {}) {
  console.log(`[ig] Procesando mensaje de ${senderId}: "${text}"${deAnuncio ? ' (viene del anuncio)' : ''}`);
  const session = getIgSession(senderId);
  const esPrimeraRespuesta = !session.messages.some((m) => m.role === 'assistant');

  // El referral llega una sola vez, en el mensaje que abre la charla: nos lo
  // guardamos para que el resto de la conversación siga sabiendo de dónde vino.
  if (deAnuncio) session.origen = 'anuncio';

  session.messages.push({ role: 'user', content: text });
  if (session.messages.length > 40) session.messages = session.messages.slice(-40);

  let globos;
  try {
    globos = await responder(session.messages, {
      channel: 'instagram', esPrimeraRespuesta, origen: session.origen,
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

  session.messages.push({ role: 'assistant', content: globos.join('\n') });
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
            session.humanUntil = Date.now() + HUMAN_HANDOFF_MS;
            console.log(`[webhook] Respuesta manual detectada para ${recipientId} — pauso ${HUMAN_HANDOFF_MS / 60000} min`);
          }
          continue;
        }

        if (!senderId) continue;
        if (!msg.text) continue; // por ahora solo texto

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

        handleIgMessage(senderId, msg.text, { deAnuncio: vieneDeAnuncio(event) })
          .catch((err) => console.error('[ig] handle error:', err.message));
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
});
