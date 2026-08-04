# Fútbol Queens Bot

Chatbot de Fútbol Queens, escuela de fútbol para niñas y adolescentes de 4 a 17 años
con cuatro sedes en CABA. Atiende el widget web y los DM de Instagram.

El bot no da información: **califica** (edad + cercanía a una sede) y recién entonces
pasa horarios, grupos y precios, para llevar a la familia a una clase de prueba.

## Arranque

```bash
npm install
cp .env.example .env     # completá ANTHROPIC_API_KEY
npm run dev
```

Abrí http://localhost:3000 para probarlo en un chat de prueba.

## Estructura

| Archivo | Qué hace |
|---|---|
| [prompt.js](prompt.js) | Todo el conocimiento del negocio: sedes, grupos, horarios, precios, reglas. **Es el archivo que se toca cuando cambia algo del cliente.** |
| [bot.js](bot.js) | Núcleo: llamada al modelo y formato de salida (globos de chat, limpieza de `¿` y markdown) |
| [server.js](server.js) | Endpoints: `/chat` para el widget web, `/webhook` para Instagram |
| [BRIEF.md](BRIEF.md) | Lo que quedó definido, lo que decidí por mi cuenta y **las preguntas abiertas para la agencia** |
| [eval/](eval/) | 53 casos de prueba en 11 categorías |

No hay API externa ni tools: todo el conocimiento es estático y vive en `prompt.js`.
Si un dato no está ahí, el bot no lo sabe y tiene que derivar al WhatsApp.

## Endpoints

**`POST /chat`** — widget web

```json
{ "messages": [{ "role": "user", "content": "hola" }] }
```

Responde con un array de globos, para renderizarlos de a uno:

```json
{ "messages": ["Hola, cómo estás? 💜 ...", "Tenemos sedes en ...", "De dónde son ustedes?"] }
```

**`GET|POST /webhook`** — Instagram DM. El `GET` es el handshake de verificación de
Meta; el `POST` recibe los mensajes.

## Formato de las respuestas

El guion pide mensajes cortos en varios envíos, como globos de chat. El modelo separa
cada globo con una línea de tres guiones y `separarEnGlobos()` los parte.

Dos reglas del guion se rompen seguido, así que además de pedírselas al modelo se
fuerzan por código en [bot.js](bot.js):

- **Sin `¿` ni `¡`** — el español correcto sí los lleva, así que el modelo los mete
  todo el tiempo. Se eliminan después de generar.
- **Sin markdown** — el chat no lo renderiza.

## Eval

53 casos que cubren calificación, cobertura de sedes por edad, precios, derivación de
mayores de 18, matrícula, combinaciones, anti-alucinación, formato, multi-turno,
derivación al WhatsApp (categoría J: Sala de 4 como piso y el link con resumen) y
recomendación de sede según el barrio (categoría K).

```bash
npm run eval                        # pide confirmación antes de arrancar
node eval/run-eval.js --categoria B # solo una categoría
node eval/run-eval.js --casos B4,C2 # casos puntuales
```

**Consume tokens** (unas 130 llamadas a la API en la corrida completa), por eso pide
confirmación. Para re-testear un fix puntual usá `--casos`.

Corré el eval cada vez que se toque `prompt.js`. Los resultados quedan en
`eval/results/` (no versionados).

## Instagram

Requiere una App de Meta propia del cliente y el App Review del permiso
`instagram_business_manage_messages`. **Arrancá ese trámite desde el día uno**: es el
camino crítico en tiempo. Hasta que esté aprobado, el bot solo responde a cuentas
testers.

Variables en `.env`: `IG_VERIFY_TOKEN`, `IG_ACCESS_TOKEN`, `IG_APP_SECRET`.

El bot detecta si alguien del equipo contesta a mano en un chat y se calla en esa
conversación por 2 horas, para no pisar la respuesta humana.

Por defecto contesta a toda hora. Para que cubra solo la noche y una persona atienda
de día, definí `IG_BOT_START_HOUR` y `IG_BOT_END_HOUR`.

## Modelo

`claude-opus-5` con effort `medium`. El effort importa acá: la tabla de precios tiene
grupos que se superponen y sedes que no cubren todas las edades, así que bajarlo a
`low` arriesga errores de matching. Ambos son configurables por `.env`
(`BOT_MODEL`, `BOT_EFFORT`) si hace falta mover el balance de costo.
# futbolQueenBot
