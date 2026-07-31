# Brief del bot — Fútbol Queens

Volcado del documento `Futbol_Queens_Guion_Apertura_Bot.docx.pdf` más lo que respondió
la agencia. **Al 30/07/2026 no queda ninguna pregunta abierta**: la sección 3 es el
registro de qué se preguntó y qué contestaron, y por qué el bot dice lo que dice.

---

## 1. Lo que quedó definido

**Identidad.** Asistente de Fútbol Queens, escuela de fútbol para niñas y
adolescentes de 4 a 17 años, cuatro sedes en CABA. Tono conversacional rioplatense,
cercano y profesional. Contacto: WhatsApp 11 2394 7419 · futbolqueens.com

**Objetivo del bot.** Calificar (edad + cercanía a una sede) y recién después pasar
horarios, grupos y precios. No es un bot informativo: la información es la
herramienta para llegar a la clase de prueba, que coordina una persona.

**Reglas de formato duras** (están en el prompt *y* forzadas por código en
[bot.js](bot.js), porque el modelo tiende a romperlas):
- Sin signo de apertura `¿` ni `¡` — se eliminan por código después de generar.
- Mensajes cortos separados en globos de chat (delimitador `---`), máximo 3.
- Sin markdown — se limpia por código.
- 💜 solo en el saludo inicial.
- El link de WhatsApp lo arma el código, no el modelo: escribe `[[WSP: resumen]]` y
  `insertarLinkWsp()` lo reemplaza por la URL con el texto url-encodeado.

**Apertura.** Dos mensajes por código, no por la IA: saludo y pregunta de zona. La
agencia pidió sacar el listado de sedes de la apertura para no ser reiterativo — el bot
recomienda la sede según el barrio que contesten.

**Canales.** Instagram DM (`/webhook`). El widget web (`/chat`) queda como banco de
pruebas y por si más adelante lo quieren en el sitio. WhatsApp lo atiende Demián.

---

## 2. Decisiones tomadas y dónde viven

| # | Tema | Qué hace el bot | Dónde |
|---|---|---|---|
| 1 | Cómo se agenda la clase de prueba | No la agenda. Con edad (en rango) y sede, cierra pasando el link de WhatsApp con un resumen de la charla ya escrito | `prompt.js` CÓMO DERIVAR AL WHATSAPP · `bot.js` `insertarLinkWsp()` |
| 2 | Edad → grado escolar | Equivalencia estándar de CABA. Con 4 o 5 años repregunta la sala, porque a esa edad la edad sola no alcanza | `prompt.js` PASO 2 BIS y DE EDAD A GRUPO ESCOLAR |
| 3 | Piso de la escuela | Sala de 4. Con Sala de 3 avisa que todavía no la reciben y la invita para el año que viene, sin pasar precios ni derivar | `prompt.js` SALA DE 3: TODAVÍA NO |
| 4 | Horario del WhatsApp | Fuera de 9-22 deriva igual pero no promete respuesta inmediata. Se mueve con `WSP_HORA_DESDE` / `WSP_HORA_HASTA` | `bot.js` `notaHorarioWsp()` |
| 5 | Barrio → sede | Mapa de los barrios de CABA a la sede más cercana, con los barrios que tienen dos opciones marcados. Fuera de CABA aclara que las sedes son en Capital pero igual las menciona | `prompt.js` DE QUÉ BARRIO SON |
| 6 | Primer mensaje con info | Sale igual la apertura y el bot sigue desde ahí. Si es solo un saludo (incluso "hola, cómo estás?"), sale la apertura y nada más | `bot.js` `esSoloSaludo()` |
| 7 | Qué edades NO cubre cada sede | Derivado de las tablas y escrito explícito, para que no ofrezca un grupo inexistente | `prompt.js` QUÉ SEDE ACEPTA QUÉ EDAD |
| 8 | Cuándo se calla el bot en Instagram | Contesta siempre. Se puede restringir con `IG_BOT_START_HOUR` / `IG_BOT_END_HOUR` | `.env.example` |

---

## 3. Lo que preguntamos y lo que respondió la agencia

Respuestas de Victoria, 30/07/2026. Todas ya implementadas.

### 3.1 La clase de prueba se contradecía en el documento

La sección 7 decía "NO se cobra" y dos renglones después "se abona el mes completo
incluyendo la clase de prueba que ya tomó".

**Respuesta: es sin costo y punto. Lo demás se charla en persona, el bot no se mete.**
El bot dice "la clase de prueba es sin costo", sin condiciones. Si le preguntan qué pasa
si después se queda, no improvisa: deriva.

### 3.2 "Media matrícula: $35.000"

**Respuesta: es una promoción válida solo por agosto. En septiembre se actualiza.**
El bot lo dice como promo de agosto, que es un motivo real para no patearlo. ⚠️ **En
septiembre hay que actualizar este número en `prompt.js`.**

### 3.3 Grupos que se superponen en Villa Crespo

**Respuesta: se ofrecen todos los días de ambos grupos, con el precio más alto.**
- 3er/4to grado (8-9 años): días de los dos grupos, precio único $85.000 / $93.000. El
  bot ya no menciona los $82.000.
- 1er año (13 años): días de ambos, mismo precio.

Se presenta como una sola propuesta con varias opciones de día, no como dos grupos.

### 3.4 Huecos de cobertura por edad

**Respuesta: son reales, es lo que hay disponible en cada sede.** Queda así:

| Sede | Cubre | NO cubre |
|---|---|---|
| Villa Crespo | Sala de 4 a 5to año (4 a 17) | — |
| Núñez | 1er grado a 5to año (6 a 17) | Sala de 4 y Sala de 5 |
| Colegiales | Sala de 5 a 2do año (5 a 14) | Sala de 4, y de 15 a 17 |
| Caballito | 3er grado a 5to año (8 a 17) | Sala de 4 hasta 2do grado |

### 3.5 Combinaciones entre sedes

**Respuesta: que no se meta, lo charlan con Demián.** El bot confirma que se puede
combinar y deriva. Ya no da el precio de la combinación Villa Crespo + Caballito
($107.000 / $115.000) que figuraba en el documento — está sacado del prompt a propósito
para que no pueda cotizarla.

### 3.6 Horarios "a confirmar" en Núñez

**Respuesta: mostrarlos igual, aclarando que falta confirmar si se armó el grupo, y dar
una segunda opción en otra sede.** El bot ofrece el horario, avisa que depende de que se
arme el grupo y pregunta qué otra zona les queda cómoda por las dudas.

### 3.7 Datos que el bot no tenía

Ahora **sí** contesta, sin derivar:
- **Qué llevar:** ropa cómoda, zapatillas deportivas, agua y el pelo atado.
- **Torneos:** internos dentro de las clases, sin costo adicional. Aparte, torneo
  formativo interno los sábados en La Cantera, Villa del Parque, con inscripción aparte.
- **Vacaciones:** en invierno la actividad sigue normal, no hay colonia. En verano la
  escuela cierra enero y febrero.

Sigue derivando, por decisión de la agencia: formas de pago / alias / CBU, vacantes,
seguro médico y apto físico, becas y planes de pago, quiénes son las profes.

### 3.8 El precio en efectivo es MÁS BARATO que por transferencia

**Confirmado**, $8.000 de diferencia en todos los casos. Queda anotado porque es al revés
de lo habitual y alguien lo va a querer "corregir". **No es un error de tipeo.**

### 3.9 Canal

**El bot va a Instagram solamente.** El WhatsApp lo atiende Demián.

### 3.10 Ubicación geográfica

La agencia pidió que recomiende sede según el barrio, y que si son de fuera de CABA lo
aclare pero igual mencione las sedes sin cortar la charla. Implementado con un mapa de
barrios en el prompt.

---

## 4. Vigencia y mantenimiento

- Los precios son de **agosto 2026**. Cuando cambien, se toca únicamente la sección
  HORARIOS Y PRECIOS de [prompt.js](prompt.js) y se vuelve a correr el eval.
- ⚠️ **Septiembre 2026:** vence la promo de media matrícula ($35.000). Hay que
  actualizar el número y la frase de "promo de agosto" en la sección MATRÍCULA.
- Los horarios A CONFIRMAR de Núñez hay que sacarlos del prompt cuando la escuela
  confirme si se armaron los grupos.
