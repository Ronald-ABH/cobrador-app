const express = require("express");
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
      `SELECT ${FECHA_LOCAL_SQL} AS dia, SUM(pa.valor) AS total
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
