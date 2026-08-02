const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Registrar un pago sobre una cuota (permite pagos parciales)
router.post("/", (req, res) => {
  const { cuota_id, valor, notas } = req.body || {};
  if (!cuota_id || !valor || Number(valor) <= 0) {
    return res.status(400).json({ error: "Datos de pago inválidos" });
  }

  const cuota = db.prepare("SELECT * FROM cuotas WHERE id = ?").get(cuota_id);
  if (!cuota) return res.status(404).json({ error: "Cuota no encontrada" });

  const tx = db.transaction(() => {
    const nuevoPagado = Math.round((cuota.valor_pagado + Number(valor)) * 100) / 100;
    const estado = nuevoPagado >= cuota.valor ? "pagada" : "parcial";
    const fechaPago = estado === "pagada" ? new Date().toISOString() : cuota.fecha_pago;

    db.prepare(
      "UPDATE cuotas SET valor_pagado = ?, estado = ?, fecha_pago = ? WHERE id = ?"
    ).run(nuevoPagado, estado, fechaPago, cuota_id);

    db.prepare(
      "INSERT INTO pagos (cuota_id, prestamo_id, valor, notas) VALUES (?, ?, ?, ?)"
    ).run(cuota_id, cuota.prestamo_id, valor, notas || null);

    // Si ya no quedan cuotas pendientes, marca el préstamo como pagado
    const pendientes = db
      .prepare(
        "SELECT COUNT(*) AS n FROM cuotas WHERE prestamo_id = ? AND estado != 'pagada'"
      )
      .get(cuota.prestamo_id).n;
    if (pendientes === 0) {
      db.prepare("UPDATE prestamos SET estado = 'pagado' WHERE id = ?").run(cuota.prestamo_id);
    }
  });

  tx();
  res.json({ ok: true });
});

// Deshacer el último pago de una cuota (por si se registró un error)
router.delete("/:pagoId", (req, res) => {
  const pago = db.prepare("SELECT * FROM pagos WHERE id = ?").get(req.params.pagoId);
  if (!pago) return res.status(404).json({ error: "Pago no encontrado" });

  const tx = db.transaction(() => {
    const cuota = db.prepare("SELECT * FROM cuotas WHERE id = ?").get(pago.cuota_id);
    const nuevoPagado = Math.max(0, Math.round((cuota.valor_pagado - pago.valor) * 100) / 100);
    const estado = nuevoPagado <= 0 ? "pendiente" : nuevoPagado >= cuota.valor ? "pagada" : "parcial";
    db.prepare("UPDATE cuotas SET valor_pagado = ?, estado = ? WHERE id = ?").run(
      nuevoPagado,
      estado,
      cuota.id
    );
    db.prepare("DELETE FROM pagos WHERE id = ?").run(pago.id);
    db.prepare("UPDATE prestamos SET estado = 'activo' WHERE id = ?").run(pago.prestamo_id);
  });
  tx();
  res.json({ ok: true });
});

// Historial de pagos de un préstamo
router.get("/prestamo/:prestamoId", (req, res) => {
  const pagos = db
    .prepare("SELECT * FROM pagos WHERE prestamo_id = ? ORDER BY fecha DESC")
    .all(req.params.prestamoId);
  res.json(pagos);
});

// Cuotas del día (para la ruta de cobro de hoy), opcionalmente filtradas por ruta
router.get("/agenda/hoy", (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const rutaId = req.query.ruta_id;

  let query = `
    SELECT cu.*, p.cliente_id, p.frecuencia, p.tipo_interes,
           c.nombre AS cliente_nombre, c.telefono, c.direccion, c.ruta_id,
           r.nombre AS ruta_nombre
    FROM cuotas cu
    JOIN prestamos p ON p.id = cu.prestamo_id
    JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN rutas r ON r.id = c.ruta_id
    WHERE p.estado = 'activo' AND cu.estado != 'pagada'
      AND cu.fecha_vencimiento <= ?
  `;
  const params = [hoy];
  if (rutaId) {
    query += " AND c.ruta_id = ?";
    params.push(rutaId);
  }
  query += " ORDER BY r.orden, c.nombre";

  const cuotas = db.prepare(query).all(...params);
  const conEstado = cuotas.map((c) => ({
    ...c,
    atrasada: c.fecha_vencimiento < hoy,
  }));
  res.json(conEstado);
});

module.exports = router;
