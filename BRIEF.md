# Brief del bot — Fútbol Queens

Volcado del documento `Futbol_Queens_Guion_Apertura_Bot.docx.pdf` más las decisiones
que hubo que tomar para que el bot funcione. **La sección 3 es la que hay que
llevarle a la agencia**: son huecos y contradicciones del material que hoy están
tapados con una decisión provisoria. La versión para mandar, sin jerga técnica, está
en [PREGUNTAS-AGENCIA.md](PREGUNTAS-AGENCIA.md).

---

## 1. Lo que quedó definido

**Identidad.** Asistente de Fútbol Queens, escuela de fútbol para niñas y
adolescentes de 4 a 17 años, cuatro sedes en CABA. Tono conversacional rioplatense,
cercano y profesional. Contacto: WhatsApp 11 2394 7419 · futbolqueens.com

**Objetivo del bot.** Calificar (edad + cercanía a una sede) y recién después pasar
horarios, grupos y precios. No es un bot informativo: la información es la
herramienta para llegar a la clase de prueba.

**Reglas de formato duras** (están en el prompt *y* forzadas por código en
[bot.js](bot.js), porque el modelo tiende a romperlas):
- Sin signo de apertura `¿` ni `¡` — se eliminan por código después de generar.
- Mensajes cortos separados en globos de chat (delimitador `---`), máximo 3.
- Sin markdown — se limpia por código.
- 💜 solo en el saludo inicial.

**Canales.** Instagram DM (`/webhook`) — confirmado por la agencia el 30/07: el bot va
a Instagram solamente. El widget web (`/chat`) queda como banco de pruebas y por si más
adelante lo quieren en el sitio. WhatsApp lo atiende Demián, una persona.

---

## 2. Decisiones que tomé para desbloquear

Ninguna está en el documento. Todas son reversibles.

| # | Hueco | Decisión provisoria | Dónde vive |
|---|---|---|---|
| 1 | ~~El doc no dice **cómo se agenda la clase de prueba**~~ **Resuelto e implementado 30/07** | No se agenda por el bot. Cuando tiene edad (en rango) y sede, cierra pasando el link del WhatsApp de Demián con un resumen de la charla ya escrito. El modelo no arma la URL: escribe `[[WSP: resumen]]` y `bot.js` lo reemplaza por `https://api.whatsapp.com/send/?phone=5491123947419&…&text=<encodeado>` | `prompt.js` sección CÓMO DERIVAR AL WHATSAPP · `bot.js` `insertarLinkWsp()` |
| 2 | No hay **mapeo de edad a grado escolar**, pero los grupos están por grado y la gente dice la edad | Equivalencia estándar de CABA (6 años = 1er grado, 13 = 1er año, 17 = 5to año). **Corregido 30/07:** con 4 o 5 años el bot repregunta la sala, porque una nena que cumplió 4 este año suele estar en Sala de 3. De 6 en adelante alcanza con la edad | `prompt.js`, PASO 2 BIS y sección DE EDAD A GRUPO ESCOLAR |
| 8 | El doc dice "desde 4 años", pero el piso real es **Sala de 4** | Con Sala de 3 el bot avisa que todavía no la pueden recibir y la invita para el año que viene. No pasa precios ni deriva para inscribirla | `prompt.js`, sección SALA DE 3: TODAVÍA NO |
| 9 | Hasta qué hora se puede prometer respuesta en el WhatsApp | Demián atiende casi todo el día. Fuera de 9-22 el bot deriva igual pero avisa que le responden al otro día. La franja se mueve con `WSP_HORA_DESDE` / `WSP_HORA_HASTA` | `bot.js`, `notaHorarioWsp()` |
| 3 | Qué hacer si el primer mensaje del usuario ya trae edad y zona | Salen igual los 3 mensajes de apertura y el bot sigue desde la información que ya dio. Si el mensaje es solo un saludo, salen los 3 y nada más | `bot.js`, `esSoloSaludo()` |
| 4 | Contradicción sobre la clase de prueba (ver 3.1) | Formulación canónica única, escrita palabra por palabra en el prompt | `prompt.js`, sección MATRÍCULA Y CLASE DE PRUEBA |
| 5 | Grupos que se superponen (ver 3.3) | El bot muestra las dos opciones con sus precios y aclara que la escuela confirma cuál corresponde | `prompt.js`, nota en VILLA CRESPO |
| 6 | El material no dice qué edades **no** cubre cada sede | Lo derivé de las tablas y lo escribí explícito, para que el bot no ofrezca un grupo inexistente | `prompt.js`, sección QUÉ SEDE ACEPTA QUÉ EDAD |
| 7 | Horario de atención humana / cuándo debe callarse el bot en Instagram | El bot contesta siempre. Se puede restringir a una franja con `IG_BOT_START_HOUR` / `IG_BOT_END_HOUR` sin tocar código | `.env.example` |

---

## 3. Preguntas para la agencia

> **Versión para mandar:** [PREGUNTAS-AGENCIA.md](PREGUNTAS-AGENCIA.md) — misma info,
> sin jerga técnica, con las respuestas del 30/07 ya incorporadas.

**Respondido el 30/07 (Victoria) y ya implementado:** Instagram solamente, WhatsApp lo
atiende Demián — cae la 3.9. El bot deriva con edad + sede y cierra con el link de
WhatsApp con resumen — cae "cómo se agenda la clase de prueba" de la 3.7. El piso es
**Sala de 4**: con 4 o 5 años el bot repregunta la sala, y con Sala de 3 avisa que la
esperan el año que viene. Demián atiende casi todo el día; después de las 22 el bot no
promete respuesta inmediata.

**Lo único que quedó abierto de esa tanda:** si está bien redactado el mensaje de
resumen que el bot deja escrito en el WhatsApp (ver PREGUNTAS-AGENCIA.md, punto 1).

### 3.1 La clase de prueba se contradice consigo misma

La sección 7 dice **"La clase de prueba NO se cobra"** y dos renglones después
**"si la alumna prueba y le gusta, se abona el mes completo incluyendo la clase de
prueba que ya tomó"**. La sección 11 lo aclara mejor: *"es gratuita; si la alumna
continúa, se cobra esa clase dentro del primer mes"*.

Lo unifiqué así, y el bot lo dice con estas palabras:

> La clase de prueba no la cobramos. Si le gusta y se queda, se abona el mes
> completo (que ya incluye esa clase) más la matrícula. Y si no se adapta, no pagás nada.

**Confirmar que esa es la política real.** Si el bot dice "es gratis" a secas y
después le cobran el mes completo, eso es un reclamo asegurado.

### 3.2 "Media matrícula: $35.000"

No queda claro si el concepto se llama "media matrícula" y cuesta $35.000, o si la
matrícula completa son $70.000 y en esta época del año se cobra la mitad. Hoy el bot
dice "Media matrícula: $35.000". **Si es una promoción con fecha de vencimiento, hay
que saber cuándo vence.**

### 3.3 Hay chicas que entran en dos grupos con precios distintos

En **Villa Crespo**:
- Una nena de **3er o 4to grado (8-9 años)** entra en *2do a 4to grado* ($82.000) y
  también en *3er grado a 1er año* ($85.000).
- Una de **1er año (13 años)** entra en *3er grado a 1er año* ($85.000) y en
  *1er a 5to año* ($85.000) — acá coincide el precio, pero no los días.

Hoy el bot muestra las dos opciones y deriva la decisión a la escuela. **Si hay un
criterio real para asignar el grupo, pasámelo y lo hago determinístico.**

### 3.4 Huecos de cobertura por edad — confirmar que son reales

Derivado de las tablas, hoy queda así:

| Sede | Cubre | Lo que NO cubre |
|---|---|---|
| Villa Crespo | Sala de 4 a 5to año (4 a 17) | — |
| Núñez | 1er grado a 5to año (6 a 17) | Sala de 4 y Sala de 5 |
| Colegiales | Sala de 5 a 2do año (5 a 14) | Sala de 4, y de 15 a 17 |
| Caballito | 3er grado a 5to año (8 a 17) | Sala de 4 hasta 2do grado |

Consecuencias que el bot está diciendo hoy:
- Una nena de **Sala de 4 solo puede ir a Villa Crespo**.
- Una chica de **15 a 17 años no puede ir a Colegiales**.
- Un nene… perdón, una nena de **5, 6 o 7 años no puede ir a Caballito**.

**Confirmar que es correcto** y no que faltan filas en las tablas.

### 3.5 Combinaciones entre sedes

El material lista **una sola combinación con precio** (Lunes en Villa Crespo +
Miércoles en Caballito, $107.000 / $115.000), pero el detalle de días por grupo de
Villa Crespo sugiere que se pueden armar varias más.

Hoy el bot confirma que se puede combinar pero **no inventa precios**: deriva a la
escuela para el presupuesto. **Si hay una regla de precios para combinaciones
(por ejemplo, "se suman los días y se aplica la tarifa de 2 estímulos"), el bot puede
cotizarlas solo.**

### 3.6 Horarios "a confirmar" en Núñez

Los grupos de *1ro y 2do grado* y el horario de los lunes de *3ro a 7mo grado*
figuran como a confirmar. El bot lo aclara cada vez que los menciona.
**Cuándo se confirman?** Mientras tanto se pierde fuerza comercial en esa sede.

### 3.7 Datos que el bot no tiene y le van a preguntar seguro

Hoy, ante cualquiera de estos, deriva al WhatsApp. Cada uno que completemos es una
consulta menos para el equipo humano:

- Formas de pago: alias / CBU / si se paga en la sede
- Indumentaria: qué tiene que llevar, si hace falta comprar algo además de la camiseta
- Si hay torneos, campeonatos o partidos
- Vacantes disponibles por grupo
- Qué pasa en vacaciones de invierno y verano
- Si hay seguro médico / si piden apto físico
- Becas o planes de pago
- Quiénes son las profes

### 3.8 El precio en efectivo es MÁS BARATO que por transferencia

Confirmado en la sección 11 del documento ($8.000 de diferencia en todos los casos).
Lo dejo anotado acá porque es al revés de lo habitual y alguien lo va a querer
"corregir" en algún momento. **No es un error de tipeo.**

### 3.9 El documento apunta a WhatsApp, pero el bot va a web e Instagram — RESPONDIDA

El bot va a **Instagram solamente**; el WhatsApp lo atiende Demián. No hay que sumar
ese canal.

---

## 4. Vigencia

Todos los precios son de **agosto 2026**. Cuando cambien, se toca únicamente la
sección HORARIOS Y PRECIOS de [prompt.js](prompt.js) y se vuelve a correr el eval.
