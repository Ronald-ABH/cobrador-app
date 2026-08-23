const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generarCuotas, DIAS_POR_FRECUENCIA, sumarDias } = require("../utils/interest");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const prestamos = db
    .prepare(
      `SELECT p.*, c.nombre AS cliente_nombre
       FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json(prestamos);
});

router.get("/:id", (req, res) => {
  const prestamo = db.prepare("SELECT * FROM prestamos WHERE id = ?").get(req.params.id);
  if (!prestamo) return res.status(404).json({ error: "Préstamo no encontrado" });
  const cuotas = db
    .prepare("SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero")
    .all(req.params.id);
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(prestamo.cliente_id);
  res.json({ ...prestamo, cuotas, cliente });
});

router.post("/", (req, res) => {
  const {
    cliente_id,
    monto,
    tasa_interes,
    tipo_interes,
    frecuencia,
    num_cuotas,
    fecha_inicio,
    notas,
  } = req.body || {};

  if (!cliente_id || !monto || tasa_interes === undefined || !num_cuotas || !fecha_inicio) {
    return res.status(400).json({ error: "Faltan datos obligatorios del préstamo" });
  }

  // Antes, un valor mal formado (texto, negativo, vacío) llegaba tal cual a
  // generarCuotas() y producía cuotas con NaN que igual se guardaban en la
  // base de datos. Se valida explícitamente cada número antes de calcular
  // nada.
  const montoNum = Number(monto);
  const tasaNum = Number(tasa_interes);
  const numCuotasNum = Number(num_cuotas);
  const cliente = db.prepare("SELECT id FROM clientes WHERE id = ?").get(cliente_id);

  if (!cliente) {
    return res.status(400).json({ error: "El cliente no existe" });
  }
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: "El monto prestado debe ser un número mayor que cero" });
  }
  if (!Number.isFinite(tasaNum) || tasaNum < 0) {
    return res.status(400).json({ error: "La tasa de interés debe ser un número mayor o igual a cero" });
  }
  if (!Number.isInteger(numCuotasNum) || numCuotasNum < 1) {
    return res.status(400).json({ error: "El número de cuotas debe ser un entero mayor o igual a uno" });
  }
  if (Number.isNaN(new Date(fecha_inicio + "T00:00:00").getTime())) {
    return res.status(400).json({ error: "La fecha de inicio no es válida" });
  }

  const tipo = ["fijo", "saldo", "capitalizado"].includes(tipo_interes) ? tipo_interes : "fijo";
  const frec = ["diario", "semanal", "quincenal", "mensual"].includes(frecuencia)
    ? frecuencia
    : "diario";

  const { valor_cuota, total_pagar, cuotas } = generarCuotas({
    monto: montoNum,
    tasa: tasaNum,
    tipo,
    frecuencia: frec,
    num_cuotas: numCuotasNum,
    fecha_inicio,
  });

  const insertPrestamo = db.prepare(
    `INSERT INTO prestamos
      (cliente_id, monto, tasa_interes, tipo_interes, frecuencia, num_cuotas, fecha_inicio, valor_cuota, total_pagar, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCuota = db.prepare(
    `INSERT INTO cuotas (prestamo_id, numero, fecha_vencimiento, valor) VALUES (?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const info = insertPrestamo.run(
      cliente_id,
      montoNum,
      tasaNum,
      tipo,
      frec,
      numCuotasNum,
      fecha_inicio,
      valor_cuota,
      total_pagar,
      notas || null
    );
    const prestamoId = info.lastInsertRowid;
    for (const c of cuotas) {
      insertCuota.run(prestamoId, c.numero, c.fecha_vencimiento, c.valor);
    }
    return prestamoId;
  });

  const prestamoId = tx();
  res.json({ id: prestamoId, valor_cuota, total_pagar });
});

router.put("/:id/cancelar", (req, res) => {
  db.prepare("UPDATE prestamos SET estado = 'cancelado' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Editar la fecha de vencimiento de una cuota puntual. Las cuotas siguientes
// (número mayor) se recalculan automáticamente en cadena, cada una a la
// distancia normal de la frecuencia del préstamo, contando desde la nueva
// fecha. Así, si el cliente empieza a pagar más tarde de lo previsto (o el
// dueño simplemente se equivocó al poner la fecha), basta con corregir esa
// cuota y el resto del calendario se acomoda solo.
router.put("/:prestamoId/cuotas/:cuotaId/fecha", (req, res) => {
  const { fecha_vencimiento } = req.body || {};
  if (!fecha_vencimiento) {
    return res.status(400).json({ error: "Falta la nueva fecha" });
  }

  const prestamo = db.prepare("SELECT * FROM prestamos WHERE id = ?").get(req.params.prestamoId);
  if (!prestamo) return res.status(404).json({ error: "Préstamo no encontrado" });

  const cuota = db
    .prepare("SELECT * FROM cuotas WHERE id = ? AND prestamo_id = ?")
    .get(req.params.cuotaId, prestamo.id);
  if (!cuota) return res.status(404).json({ error: "Cuota no encontrada" });

  const diasPeriodo = DIAS_POR_FRECUENCIA[prestamo.frecuencia] || 1;

  const tx = db.transaction(() => {
    db.prepare("UPDATE cuotas SET fecha_vencimiento = ? WHERE id = ?").run(
      fecha_vencimiento,
      cuota.id
    );

    const siguientes = db
      .prepare("SELECT * FROM cuotas WHERE prestamo_id = ? AND numero > ? ORDER BY numero")
      .all(prestamo.id, cuota.numero);

    let fechaAnterior = fecha_vencimiento;
    for (const sig of siguientes) {
      fechaAnterior = sumarDias(fechaAnterior, diasPeriodo);
      db.prepare("UPDATE cuotas SET fecha_vencimiento = ? WHERE id = ?").run(
        fechaAnterior,
        sig.id
      );
    }
  });

  tx();
  res.json({ ok: true });
});

module.exports = router;
