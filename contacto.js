// Número de WhatsApp del equipo, tal como se lo decimos a la familia.
// Vive aparte porque lo usan bot.js y prompt.js, y bot.js ya importa prompt.js:
// si prompt.js lo importara de bot.js, el import circular lo dejaría sin definir
// cuando se arma el SYSTEM_PROMPT.
export const CONTACTO_WSP = '11 2394 7419';
