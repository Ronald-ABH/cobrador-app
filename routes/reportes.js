const express = require("express");
const ExcelJS = require("exceljs");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { hoyISO, sumarDiasISO, SQLITE_OFFSET } = require("../utils/fecha");

const router = express.Router();
router.use(requireAuth);

// pagos.fecha se guarda como instante UTC (datetime('now') / toISOString()).
// Para agruparlo "por día calendario de Colombia" hay que restarle el
// desfase horario antes de pedirle la fecha a SQLite; si no, un pago hecho
// a las 8pm en Bogotá (ya medianoche o más en UTC) se contaría en el día
// siguiente. Colombia no tiene horario de verano, así que el desfase es
// siempre el mismo (ver utils/fecha.js).
const FECHA_LOCAL_SQL = `date(pa.fecha, '${SQLITE_OFFSET}')`;

router.get("/resumen", (req, res) => {
  // Fecha de hoy en hora de Colombia, no en UTC (ver utils/fecha.js).
  const hoy = hoyISO();

  // En todas las consultas se une con "clientes" y se exige activo = 1, para
  // que los préstamos y pagos de un cliente eliminado dejen de contarse en
  // los totales (aunque el historial se conserva en la base de datos).
  const totalPrestado = db
    .prepare(
      `SELECT COALESCE(SUM(p.monto),0) AS v
       FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado != 'cancelado' AND c.activo = 1`
    )
    .get().v;

  const totalPorCobrar = db
    .prepare(
      `SELECT COALESCE(SUM(cu.valor - cu.valor_pagado),0) AS v
       FROM cuotas cu
       JOIN prestamos p ON p.id = cu.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = 'activo' AND cu.estado != 'pagada' AND c.activo = 1`
    )
    .get().v;

  const moraTotal = db
    .prepare(
      `SELECT COALESCE(SUM(cu.valor - cu.valor_pagado),0) AS v
       FROM cuotas cu
       JOIN prestamos p ON p.id = cu.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = 'activo' AND cu.estado != 'pagada' AND cu.fecha_vencimiento < ? AND c.activo = 1`
    )
    .get(hoy).v;

  const recaudadoHoy = db
    .prepare(
      `SELECT COALESCE(SUM(pa.valor),0) AS v
       FROM pagos pa
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE ${FECHA_LOCAL_SQL} = ? AND c.activo = 1`
    )
    .get(hoy).v;

  const totalRecaudadoHistorico = db
    .prepare(
      `SELECT COALESCE(SUM(pa.valor),0) AS v
       FROM pagos pa
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE c.activo = 1`
    )
    .get().v;

  // "Ganancia proyectada" = lo que TODAVÍA falta por ganar, no el interés
  // de la vida entera del préstamo. De cada préstamo activo se separa qué
  // porción de su total a pagar es interés (total_pagar - monto, sobre
  // total_pagar) y esa misma proporción se le aplica a lo que le queda
  // pendiente de cobrar a ese préstamo — así un préstamo casi pagado ya no
  // "proyecta" la ganancia que ya se cobró hace tiempo, solo la que falta.
  const gananciaProyectada = db
    .prepare(
      `SELECT p.monto, p.total_pagar,
              COALESCE(SUM(cu.valor - cu.valor_pagado), 0) AS pendiente
       FROM prestamos p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN cuotas cu ON cu.prestamo_id = p.id AND cu.estado != 'pagada'
       WHERE p.estado = 'activo' AND c.activo = 1
       GROUP BY p.id`
    )
    .all()
    .reduce((total, p) => {
      if (!p.total_pagar || p.pendiente <= 0) return total;
      const proporcionInteres = Math.max(0, (p.total_pagar - p.monto) / p.total_pagar);
      return total + p.pendiente * proporcionInteres;
    }, 0);

  const clientesActivos = db
    .prepare("SELECT COUNT(*) AS n FROM clientes WHERE activo = 1")
    .get().n;

  const prestamosActivos = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = 'activo' AND c.activo = 1`
    )
    .get().n;

  res.json({
    totalPrestado,
    totalPorCobrar,
    moraTotal,
    recaudadoHoy,
    totalRecaudadoHistorico,
    gananciaProyectada,
    clientesActivos,
    prestamosActivos,
  });
});

// Recaudo agrupado por día, para un rango de fechas (por defecto últimos 30 días)
router.get("/recaudo-por-dia", (req, res) => {
  const hoy = hoyISO();
  const desde = req.query.desde || sumarDiasISO(hoy, -30);
  const hasta = req.query.hasta || hoy;

  const rows = db
    .prepare(
      `SELECT ${FECHA_LOCAL_SQL} AS dia, SUM(pa.valor) AS total, COUNT(*) AS cantidad
       FROM pagos pa
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE ${FECHA_LOCAL_SQL} BETWEEN ? AND ? AND c.activo = 1
       GROUP BY ${FECHA_LOCAL_SQL}
       ORDER BY dia`
    )
    .all(desde, hasta);

  res.json(rows);
});

const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Detalle de todos los pagos de préstamos hechos en un día calendario
// puntual (hora de Colombia), para el historial de pagos por día. Solo
// préstamos — los pagos de interés de empeños son un negocio aparte y no
// se mezclan aquí.
router.get("/pagos-del-dia/:fecha", (req, res) => {
  if (!FECHA_ISO_RE.test(req.params.fecha)) {
    return res.status(400).json({ error: "Fecha inválida" });
  }
  const rows = db
    .prepare(
      `SELECT pa.id, pa.valor, pa.fecha, pa.notas,
              cu.numero AS cuota_numero,
              c.id AS cliente_id, c.nombre AS cliente_nombre,
              p.id AS prestamo_id
       FROM pagos pa
       JOIN cuotas cu ON cu.id = pa.cuota_id
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE ${FECHA_LOCAL_SQL} = ? AND c.activo = 1
       ORDER BY pa.fecha DESC, pa.id DESC`
    )
    .all(req.params.fecha);

  res.json(rows);
});

// Ganancia REAL ya cobrada (no proyectada), agrupada por día, semana, mes o
// año. Como cuotas/pagos no separan capital e interés, se usa el mismo
// método que "ganancia proyectada" del resumen: a cada pago se le aplica la
// proporción de interés de SU préstamo — (total_a_pagar - monto) /
// total_a_pagar — y esa parte es la que cuenta como ganancia.
router.get("/ganancia-por-periodo", (req, res) => {
  const periodo = ["dia", "semana", "mes", "anio"].includes(req.query.periodo)
    ? req.query.periodo
    : "dia";
  const hoy = hoyISO();

  // No tiene sentido traer años de datos para agruparlos por día, ni traer
  // apenas un mes para intentar ver una tendencia anual.
  const diasHaciaAtras = { dia: 30, semana: 12 * 7, mes: 366, anio: 5 * 366 }[periodo];
  const desde = sumarDiasISO(hoy, -diasHaciaAtras);

  const filas = db
    .prepare(
      `SELECT ${FECHA_LOCAL_SQL} AS dia_local, pa.valor AS valor_pago, p.monto, p.total_pagar
       FROM pagos pa
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE ${FECHA_LOCAL_SQL} BETWEEN ? AND ? AND c.activo = 1`
    )
    .all(desde, hoy);

  // Clave de agrupación a partir de la fecha local (YYYY-MM-DD) de cada pago.
  function claveDeGrupo(diaLocal) {
    if (periodo === "dia") return diaLocal;
    if (periodo === "mes") return diaLocal.slice(0, 7); // YYYY-MM
    if (periodo === "anio") return diaLocal.slice(0, 4); // YYYY
    // "semana": se agrupa por el lunes de esa semana
    const [y, m, d] = diaLocal.split("-").map(Number);
    const fecha = new Date(Date.UTC(y, m - 1, d));
    const diaSemana = fecha.getUTCDay(); // 0=domingo..6=sábado
    const offsetHastaLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    fecha.setUTCDate(fecha.getUTCDate() - offsetHastaLunes);
    return fecha.toISOString().slice(0, 10);
  }

  const grupos = new Map();
  for (const fila of filas) {
    if (!fila.total_pagar || fila.total_pagar <= 0) continue;
    const proporcionInteres = Math.max(0, (fila.total_pagar - fila.monto) / fila.total_pagar);
    const ganancia = fila.valor_pago * proporcionInteres;
    const clave = claveDeGrupo(fila.dia_local);
    grupos.set(clave, (grupos.get(clave) || 0) + ganancia);
  }

  const resultado = Array.from(grupos.entries())
    .map(([periodo_key, ganancia]) => ({
      periodo: periodo_key,
      ganancia: Math.round(ganancia * 100) / 100,
    }))
    .sort((a, b) => (a.periodo < b.periodo ? -1 : 1));

  res.json(resultado);
});

// Descarga en Excel de los pagos de préstamos (para que Ronald tenga su
// propia copia legible, aparte del backup automático diario en .db/.json).
router.get("/exportar-pagos", async (req, res) => {
  const rango = ["dia", "mes", "anio", "todo"].includes(req.query.rango) ? req.query.rango : "dia";
  const hoy = hoyISO();

  let desde = null;
  if (rango === "dia") desde = hoy;
  else if (rango === "mes") desde = hoy.slice(0, 7) + "-01";
  else if (rango === "anio") desde = hoy.slice(0, 4) + "-01-01";
  // "todo": sin límite inferior, se trae el historial completo.

  let query = `
    SELECT ${FECHA_LOCAL_SQL} AS fecha_local, pa.fecha AS fecha_hora, pa.valor, pa.notas,
           c.nombre AS cliente_nombre, cu.numero AS cuota_numero, p.id AS prestamo_id
    FROM pagos pa
    JOIN cuotas cu ON cu.id = pa.cuota_id
    JOIN prestamos p ON p.id = pa.prestamo_id
    JOIN clientes c ON c.id = p.cliente_id
    WHERE c.activo = 1
  `;
  const params = [];
  if (desde) {
    query += ` AND ${FECHA_LOCAL_SQL} BETWEEN ? AND ?`;
    params.push(desde, hoy);
  }
  query += " ORDER BY pa.fecha ASC, pa.id ASC";

  const filas = db.prepare(query).all(...params);

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Pagos");
  hoja.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Hora", key: "hora", width: 10 },
    { header: "Cliente", key: "cliente", width: 30 },
    { header: "Cuota #", key: "cuota", width: 10 },
    { header: "Valor", key: "valor", width: 16 },
    { header: "Notas", key: "notas", width: 30 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const fila of filas) {
    // fecha_hora viene en UTC (datetime('now'), formato "YYYY-MM-DD HH:MM:SS"
    // sin zona) — se convierte a hora de Colombia para que coincida con lo
    // que el usuario ve en la app.
    const horaLocal = new Date(fila.fecha_hora.replace(" ", "T") + "Z").toLocaleTimeString(
      "es-CO",
      { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" }
    );
    hoja.addRow({
      fecha: fila.fecha_local,
      hora: horaLocal,
      cliente: fila.cliente_nombre,
      cuota: fila.cuota_numero,
      valor: fila.valor,
      notas: fila.notas || "",
    });
  }
  hoja.getColumn("valor").numFmt = "#,##0.00";

  const nombresPorRango = {
    dia: `pagos-hoy-${hoy}`,
    mes: `pagos-mes-${hoy.slice(0, 7)}`,
    anio: `pagos-anio-${hoy.slice(0, 4)}`,
    todo: "pagos-historico-completo",
  };
  const nombreArchivo = `${nombresPorRango[rango]}.xlsx`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// Ranking de clientes en mora (los que más deben en cuotas vencidas), para
// saber a quién priorizar sin tener que revisarlos uno por uno en Agenda.
router.get("/clientes-en-mora", (req, res) => {
  const hoy = hoyISO();
  const limite = Math.min(parseInt(req.query.limite, 10) || 10, 50);

  const rows = db
    .prepare(
      `SELECT c.id, c.nombre, c.telefono,
              SUM(cu.valor - cu.valor_pagado) AS deuda,
              COUNT(*) AS cuotas_atrasadas
       FROM cuotas cu
       JOIN prestamos p ON p.id = cu.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado = 'activo' AND cu.estado != 'pagada' AND cu.fecha_vencimiento < ? AND c.activo = 1
       GROUP BY c.id
       ORDER BY deuda DESC
       LIMIT ?`
    )
    .all(hoy, limite);

  res.json(rows);
});

module.exports = router;
