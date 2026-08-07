// El resumen de la derivación va metido en la URL de WhatsApp, url-encodeado.
// En el DM de Instagram eso se ve como un muro de %20 que ocupa media pantalla y
// no parece un link: parece un error. Así que guardamos el resumen acá y mandamos
// un link corto propio que redirige al de WhatsApp.
//
// El guardado en disco es best-effort: en Railway el filesystem es efímero, así
// que un redeploy puede perder los ids. No es grave — si llega un id que no
// conocemos igual mandamos a la familia al WhatsApp con el mensaje por defecto,
// que es peor que tener el resumen pero mucho mejor que un 404.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // los links viejos no le sirven a nadie
const MAX_LINKS = 5000;
const ARCHIVO = process.env.WSP_LINKS_FILE || './data/wsp-links.json';

const links = new Map(); // id -> { texto, creado }

// El id sale del hash del texto: el mismo resumen siempre da el mismo link, así
// que si el bot repite una derivación no llenamos el mapa de duplicados.
function idPara(texto) {
  const hash = crypto.createHash('sha256').update(texto).digest('base64url');
  // 7 caracteres alcanzan de sobra para este volumen. Si justo chocan dos textos
  // distintos, alargamos el id en vez de pisar el que ya estaba.
  for (let largo = 7; largo <= hash.length; largo++) {
    const id = hash.slice(0, largo);
    const previo = links.get(id);
    if (!previo || previo.texto === texto) return id;
  }
  return hash;
}

let avisadoFalloDisco = false;
let guardadoPendiente = null;

function persistir() {
  if (guardadoPendiente) return; // ya hay un guardado en camino, se lleva todo
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    try {
      fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
      fs.writeFileSync(ARCHIVO, JSON.stringify([...links]));
    } catch (err) {
      // Si el filesystem es de solo lectura seguimos andando en memoria: avisamos
      // una vez y no volvemos a ensuciar los logs con lo mismo.
      if (!avisadoFalloDisco) {
        console.warn(`[wsp-links] No puedo persistir en ${ARCHIVO} (${err.message}) — sigo solo en memoria`);
        avisadoFalloDisco = true;
      }
    }
  }, 2000);
  guardadoPendiente.unref?.(); // que un guardado pendiente no trabe el proceso
}

function purgar() {
  const ahora = Date.now();
  for (const [id, dato] of links) {
    if (ahora - dato.creado > TTL_MS) links.delete(id);
  }
  // El Map itera en orden de inserción: los primeros son los más viejos.
  while (links.size > MAX_LINKS) links.delete(links.keys().next().value);
}

function cargar() {
  try {
    const guardados = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    const ahora = Date.now();
    for (const [id, dato] of guardados) {
      if (ahora - dato.creado < TTL_MS) links.set(id, dato);
    }
    console.log(`[wsp-links] ${links.size} links recuperados de ${ARCHIVO}`);
  } catch {
    // Primera corrida, o el disco no sobrevivió al redeploy. Arrancamos vacíos.
  }
}

cargar();

export function guardarResumen(texto) {
  const id = idPara(texto);
  if (!links.has(id)) {
    links.set(id, { texto, creado: Date.now() });
    purgar();
    persistir();
  }
  return id;
}

export function buscarResumen(id) {
  const dato = links.get(id);
  if (!dato) return null;
  if (Date.now() - dato.creado > TTL_MS) {
    links.delete(id);
    return null;
  }
  return dato.texto;
}
