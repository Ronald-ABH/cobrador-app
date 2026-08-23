// Utilidades de fecha "conscientes" de la zona horaria de Colombia.
//
// Por qué existe este archivo: en varios lugares del código se necesitaba
// saber cuál es "el día de hoy" (para la agenda de cobro, el recaudo diario,
// la mora, etc.). La forma ingenua de hacerlo es `new Date().toISOString()`,
// pero toISOString() SIEMPRE devuelve la fecha en UTC, sin importar en qué
// zona horaria esté el servidor o el celular de quien usa la app.
//
// Colombia está en UTC-5 todo el año (no tiene horario de verano), así que
// entre las 7:00pm y la medianoche, hora Colombia, la fecha en UTC ya es la
// del día siguiente. Eso hacía que, cada noche, las cuotas del día
// siguiente aparecieran en la agenda de "hoy" antes de tiempo, y que los
// pagos registrados en la noche se contabilizaran en el recaudo de mañana
// en vez de hoy.
//
// Usando Intl.DateTimeFormat con timeZone fijo, obtenemos la fecha correcta
// sin importar en qué zona horaria esté corriendo el servidor (Railway,
// local, etc.).

const TZ = process.env.APP_TIMEZONE || "America/Bogota";

// Colombia no tiene horario de verano, así que el offset respecto a UTC es
// siempre el mismo. Se usa para que SQLite (que guarda las fechas de pago
// en UTC) agrupe "por día" usando el día calendario de Colombia.
const SQLITE_OFFSET = process.env.APP_TIMEZONE_SQLITE_OFFSET || "-5 hours";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Fecha de "hoy" en la zona horaria de la app, como texto "YYYY-MM-DD".
function hoyISO() {
  return fmt.format(new Date());
}

// Suma (o resta, con un número negativo) días de calendario a una fecha
// "YYYY-MM-DD". No depende de la hora del servidor: solo hace aritmética
// sobre la fecha en sí.
function sumarDiasISO(fechaISO, dias) {
  const f = new Date(fechaISO + "T00:00:00Z");
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

module.exports = { TZ, SQLITE_OFFSET, hoyISO, sumarDiasISO };
