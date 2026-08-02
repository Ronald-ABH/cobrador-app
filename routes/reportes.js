const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/resumen", (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);

  const totalPrestado = db
    .prepare("SELECT COALESCE(SUM(monto),0) AS v FROM prestamos WHERE estado != 'cancelado'")
    .get().v;

  const totalPorCobrar = db
    .prepare(
      `SELECT COALESCE(SUM(cu.valor - cu.valor_pagado),0) AS v
       FROM cuotas cu JOIN prestamos p ON p.id = cu.prestamo_id
       WHERE p.estado = 'activo' AND cu.estado != 'pagada'`
    )
    .get().v;

  const moraTotal = db
    .prepare(
      `SELECT COALESCE(SUM(cu.valor - cu.valor_pagado),0) AS v
       FROM cuotas cu JOIN prestamos p ON p.id = cu.prestamo_id
       WHERE p.estado = 'activo' AND cu.estado != 'pagada' AND cu.fecha_vencimiento < ?`
    )
    .get(hoy).v;

  const recaudadoHoy = db
    .prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM pagos WHERE date(fecha) = ?`)
    .get(hoy).v;

  const totalRecaudadoHistorico = db
    .prepare("SELECT COALESCE(SUM(valor),0) AS v FROM pagos")
    .get().v;

  const totalPagarProyectado = db
    .prepare("SELECT COALESCE(SUM(total_pagar),0) AS v FROM prestamos WHERE estado != 'cancelado'")
    .get().v;

  const gananciaProyectada = totalPagarProyectado - totalPrestado;

  const clientesActivos = db
    .prepare("SELECT COUNT(*) AS n FROM clientes WHERE activo = 1")
    .get().n;

  const prestamosActivos = db
    .prepare("SELECT COUNT(*) AS n FROM prestamos WHERE estado = 'activo'")
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
      `SELECT date(fecha) AS dia, SUM(valor) AS total
       FROM pagos
       WHERE date(fecha) BETWEEN ? AND ?
       GROUP BY date(fecha)
       ORDER BY dia`
    )
    .all(desde, hasta);

  res.json(rows);
});

module.exports = router;
