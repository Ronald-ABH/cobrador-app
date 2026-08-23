const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { hoyISO } = require("../utils/fecha");

const router = express.Router();
router.use(requireAuth);

// Registrar un pago. Si el valor pagado es mayor que lo que falta de la
// cuota indicada, el sobrante se va aplicando automáticamente a las
// siguientes cuotas pendientes del mismo préstamo (de la más vieja a la
// más nueva), en vez de quedar mal registrado en una sola cuota.
router.post("/", (req, res) => {
  const { cuota_id, valor, notas } = req.body || {};
  if (!cuota_id || !valor || Number(valor) <= 0) {
    return res.status(400).json({ error: "Datos de pago inválidos" });
  }

  const cuotaRef = db.prepare("SELECT * FROM cuotas WHERE id = ?").get(cuota_id);
  if (!cuotaRef) return res.status(404).json({ error: "Cuota no encontrada" });

  let sobrante = 0;

  const tx = db.transaction(() => {
    let restante = Math.round(Number(valor) * 100) / 100;

    // Todas las cuotas pendientes de este préstamo, de la más antigua a la
    // más reciente, para repartir el pago en orden.
    const cuotasPendientes = db
      .prepare(
        `SELECT * FROM cuotas WHERE prestamo_id = ? AND estado != 'pagada' ORDER BY numero`
      )
      .all(cuotaRef.prestamo_id);

    for (const cuota of cuotasPendientes) {
      if (restante <= 0) break;
      const pendienteCuota = Math.round((cuota.valor - cuota.valor_pagado) * 100) / 100;
      const aplicado = Math.min(restante, pendienteCuota);
      if (aplicado <= 0) continue;

      const nuevoPagado = Math.round((cuota.valor_pagado + aplicado) * 100) / 100;
      const estado = nuevoPagado >= cuota.valor ? "pagada" : "parcial";
      const fechaPago = estado === "pagada" ? new Date().toISOString() : cuota.fecha_pago;

      db.prepare(
        "UPDATE cuotas SET valor_pagado = ?, estado = ?, fecha_pago = ? WHERE id = ?"
      ).run(nuevoPagado, estado, fechaPago, cuota.id);

      db.prepare(
        "INSERT INTO pagos (cuota_id, prestamo_id, valor, notas) VALUES (?, ?, ?, ?)"
      ).run(cuota.id, cuota.prestamo_id, aplicado, notas || null);

      restante = Math.round((restante - aplicado) * 100) / 100;
    }

    // Si sobra dinero después de cubrir TODAS las cuotas pendientes de este
    // préstamo, significa que pagaron más de lo que debían en total. Ese
    // sobrante no se aplica a nada (se informa al usuario en la respuesta).
    sobrante = restante;

    // Si ya no quedan cuotas pendientes, marca el préstamo como pagado
    const pendientes = db
      .prepare(
        "SELECT COUNT(*) AS n FROM cuotas WHERE prestamo_id = ? AND estado != 'pagada'"
      )
      .get(cuotaRef.prestamo_id).n;
    if (pendientes === 0) {
      db.prepare("UPDATE prestamos SET estado = 'pagado' WHERE id = ?").run(cuotaRef.prestamo_id);
    }
  });

  tx();
  res.json({ ok: true, sobrante });
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

    // Si el préstamo estaba marcado 'pagado' (todas sus cuotas al día),
    // deshacer este pago hace que vuelva a quedar deuda pendiente, así que
    // pasa a 'activo'. Pero si el préstamo estaba 'cancelado' (una decisión
    // manual del usuario), deshacer un pago viejo no debe reactivarlo solo:
    // antes esto pasaba sin condición, y corregir un pago de un préstamo ya
    // cancelado lo revivía sin que nadie lo pidiera.
    const prestamo = db.prepare("SELECT estado FROM prestamos WHERE id = ?").get(pago.prestamo_id);
    if (prestamo && prestamo.estado === "pagado") {
      db.prepare("UPDATE prestamos SET estado = 'activo' WHERE id = ?").run(pago.prestamo_id);
    }
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
  // Fecha de hoy en hora de Colombia, no en UTC (ver utils/fecha.js).
  const hoy = hoyISO();
  const rutaId = req.query.ruta_id;

  let query = `
    SELECT cu.*, p.cliente_id, p.frecuencia, p.tipo_interes,
           c.nombre AS cliente_nombre, c.telefono, c.direccion, c.ruta_id,
           r.nombre AS ruta_nombre
    FROM cuotas cu
    JOIN prestamos p ON p.id = cu.prestamo_id
    JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN rutas r ON r.id = c.ruta_id
    WHERE p.estado = 'activo' AND cu.estado != 'pagada' AND c.activo = 1
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
