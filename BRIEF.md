# Brief del bot — Fútbol Queens

Volcado del documento `Futbol_Queens_Guion_Apertura_Bot.docx.pdf` más las decisiones
que hubo que tomar para que el bot funcione. **La sección 3 es la que hay que
llevarle a la agencia**: son huecos y contradicciones del material que hoy están
tapados con una decisión provisoria.

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

**Canales.** Widget web (`/chat`) e Instagram DM (`/webhook`).

---

## 2. Decisiones que tomé para desbloquear

Ninguna está en el documento. Todas son reversibles.

| # | Hueco | Decisión provisoria | Dónde vive |
|---|---|---|---|
| 1 | El doc no dice **cómo se agenda la clase de prueba** — que es el objetivo del bot | El bot deriva al WhatsApp 11 2394 7419 y no confirma día ni horario | `prompt.js`, regla 3 y sección CONTACTO |
| 2 | No hay **mapeo de edad a grado escolar**, pero los grupos están por grado y la gente dice la edad | Equivalencia estándar de CABA (6 años = 1er grado, 13 = 1er año, 17 = 5to año), con la aclaración de que la escuela confirma el grupo | `prompt.js`, sección DE EDAD A GRUPO ESCOLAR |
| 3 | Qué hacer si el primer mensaje del usuario ya trae edad y zona | Salen igual los 3 mensajes de apertura y el bot sigue desde la información que ya dio. Si el mensaje es solo un saludo, salen los 3 y nada más | `bot.js`, `esSoloSaludo()` |
| 4 | Contradicción sobre la clase de prueba (ver 3.1) | Formulación canónica única, escrita palabra por palabra en el prompt | `prompt.js`, sección MATRÍCULA Y CLASE DE PRUEBA |
| 5 | Grupos que se superponen (ver 3.3) | El bot muestra las dos opciones con sus precios y aclara que la escuela confirma cuál corresponde | `prompt.js`, nota en VILLA CRESPO |
| 6 | El material no dice qué edades **no** cubre cada sede | Lo derivé de las tablas y lo escribí explícito, para que el bot no ofrezca un grupo inexistente | `prompt.js`, sección QUÉ SEDE ACEPTA QUÉ EDAD |
| 7 | Horario de atención humana / cuándo debe callarse el bot en Instagram | El bot contesta siempre. Se puede restringir a una franja con `IG_BOT_START_HOUR` / `IG_BOT_END_HOUR` sin tocar código | `.env.example` |

---

## 3. Preguntas para la agencia

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

| Sede | Edades que cubre | Lo que NO cubre |
|---|---|---|
| Villa Crespo | 4 a 17 | — |
| Núñez | 6 a 17 | 4 y 5 años |
| Colegiales | 5 a 14 | 4 años, y de 15 a 17 |
| Caballito | 8 a 17 | de 4 a 7 años |

Consecuencias que el bot está diciendo hoy:
- Una nena de **4 años solo puede ir a Villa Crespo**.
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
- Cómo se agenda la clase de prueba (día, cupo, con quién)
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

### 3.9 El documento apunta a WhatsApp, pero el bot va a web e Instagram

El pie del guion dice *"Contacto: WhatsApp 11 2394 7419"*. El bot que estamos
armando atiende el widget web y los DM de Instagram, y **deriva** a ese WhatsApp.
**Confirmar que el WhatsApp lo atiende una persona** — si también tiene que
atenderlo el bot, hay que sumar ese canal (no está implementado).

---

## 4. Vigencia

Todos los precios son de **agosto 2026**. Cuando cambien, se toca únicamente la
sección HORARIOS Y PRECIOS de [prompt.js](prompt.js) y se vuelve a correr el eval.
