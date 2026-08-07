const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/resumen", (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);

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
       WHERE date(pa.fecha) = ? AND c.activo = 1`
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

  const totalPagarProyectado = db
    .prepare(
      `SELECT COALESCE(SUM(p.total_pagar),0) AS v
       FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.estado != 'cancelado' AND c.activo = 1`
    )
    .get().v;

  const gananciaProyectada = totalPagarProyectado - totalPrestado;

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
  const desde = req.query.desde || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const hasta = req.query.hasta || new Date().toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `SELECT date(pa.fecha) AS dia, SUM(pa.valor) AS total
       FROM pagos pa
       JOIN prestamos p ON p.id = pa.prestamo_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE date(pa.fecha) BETWEEN ? AND ? AND c.activo = 1
       GROUP BY date(pa.fecha)
       ORDER BY dia`
    )
    .all(desde, hasta);

  res.json(rows);
});

module.exports = router;
