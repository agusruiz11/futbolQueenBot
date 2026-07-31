# Fútbol Queens — dudas del guion

Armamos el bot con el documento *Guion Apertura Bot*. Estos son los puntos que el
material no cierra o no cubre. Para cada uno hay una decisión provisoria tomada para no
frenar, pero **necesitamos confirmación** porque hoy el bot ya lo está diciendo así.

---

## Ya respondido (30/07) — no hace falta volver sobre esto

- **Canal:** el bot atiende **Instagram solamente**. WhatsApp lo sigue atendiendo Demián.
- **Cuándo deriva:** cuando ya tiene edad de la jugadora (dentro del rango) y sede de
  interés.
- **Cómo deriva:** link al WhatsApp Business con un mensaje de resumen ya escrito.
- **Sala de 4 es el piso real.** Si dicen 4 o 5 años, el bot repregunta en qué sala está,
  porque a esa edad la edad sola no alcanza.
- **Sala de 3: no hay lugar.** El bot avisa con calidez que todavía no la pueden recibir
  y que la esperan el año que viene. No pasa precios ni deriva para inscribirla.
- **Horario de Demián:** atiende casi todo el día. Después de las 22 el bot deriva igual
  pero no promete respuesta inmediata.

---

## Lo que falta

### 1. ¿Está bien redactado el mensaje de resumen que va al WhatsApp?

El bot arma el texto y se lo deja escrito a la familia en el chat, así Demián lo recibe
todo junto. Hoy queda algo así:

> Hola! Vengo del Instagram de Futbol Queens. Soy la mama de Delfi, que esta en 3er
> grado. Nos interesa la sede de Villa Crespo y queriamos coordinar una clase de prueba.

(Va sin acentos a propósito, para que el link no se rompa en algunos teléfonos.)

¿Agregan o sacan algo? ¿Hace falta el teléfono, el turno del colegio, cómo nos conoció?

### 2. La clase de prueba se contradice en el documento

La sección 7 dice "la clase de prueba NO se cobra" y dos renglones después "se abona el
mes completo incluyendo la clase de prueba que ya tomó". La sección 11 dice que es
gratuita y que si la alumna continúa, esa clase se cobra dentro del primer mes.

Unificamos así, y el bot lo dice con estas palabras:

> "La clase de prueba no la cobramos. Si le gusta y se queda, se abona el mes completo
> (que ya incluye esa clase) más la matrícula. Y si no se adapta, no pagás nada."

¿Es esa la política real? Si el bot dice "es gratis" a secas y después se cobra el mes,
es un reclamo asegurado.

### 3. "Media matrícula: $35.000"

¿El concepto se llama "media matrícula" y cuesta $35.000, o la matrícula completa son
$70.000 y en esta época se cobra la mitad? Si es una promo con vencimiento, ¿cuándo
vence?

### 4. Huecos de cobertura por edad — confirmar que son reales

Deducido de las tablas:

| Sede | Cubre | NO cubre |
|---|---|---|
| Villa Crespo | Sala de 4 a 5to año | — |
| Núñez | 1er grado a 5to año | Sala de 4 y Sala de 5 |
| Colegiales | Sala de 5 a 2do año | Sala de 4, y de 3er a 5to año |
| Caballito | 3er grado a 5to año | Sala de 4 hasta 2do grado |

O sea: una nena de Sala de 4 solo puede ir a Villa Crespo; una de 15 a 17 años no puede
ir a Colegiales; una de 5 a 7 años no puede ir a Caballito. ¿Es correcto o faltan filas
en las tablas?

### 5. Hay chicas que entran en dos grupos con precios distintos (Villa Crespo)

- 3er o 4to grado (8-9 años): entra en *2do a 4to grado* ($82.000) y en *3er grado a
  1er año* ($85.000).
- 1er año (13 años): entra en *3er grado a 1er año* y en *1er a 5to año* — mismo precio,
  distintos días.

Hoy el bot muestra las dos opciones y aclara que la escuela confirma cuál corresponde.
¿Hay un criterio fijo para asignar el grupo?

### 6. Combinaciones entre sedes

El material lista una sola combinación con precio (Lunes en Villa Crespo + Miércoles en
Caballito, $107.000 / $115.000), pero los días por grupo sugieren que se pueden armar
varias más. Hoy el bot confirma que se puede combinar pero no inventa precios: deriva
para el presupuesto. ¿Hay una regla ("se suman los días y se aplica la tarifa de 2
estímulos")? Con eso el bot cotiza solo.

### 7. Horarios "a confirmar" en Núñez

Los grupos de 1ro y 2do grado, y el horario de los lunes de 3ro a 7mo, figuran como a
confirmar. El bot lo aclara cada vez que los menciona. ¿Cuándo se confirman? Mientras
tanto se pierde fuerza comercial en esa sede.

### 8. Datos que el bot no tiene y le van a preguntar seguro

Hoy, ante cualquiera de estos, deriva a Demián. Cada uno que completemos es una consulta
menos para él:

- Formas de pago: alias / CBU / si se paga en la sede
- Indumentaria: qué tiene que llevar, si hay que comprar algo además de la camiseta
- Si hay torneos, campeonatos o partidos
- Vacantes disponibles por grupo
- Qué pasa en vacaciones de invierno y verano
- Si hay seguro médico / si piden apto físico
- Becas o planes de pago
- Quiénes son las profes

### 9. El precio en efectivo es más barato que por transferencia

Confirmado en la sección 11 del documento ($8.000 de diferencia en todos los casos). Lo
anotamos porque es al revés de lo habitual y alguien lo va a querer "corregir" en algún
momento. Confirmar que no es un error de tipeo.
