const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { generarCuotas } = require("../utils/interest");

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
  const tipo = ["fijo", "saldo", "capitalizado"].includes(tipo_interes) ? tipo_interes : "fijo";
  const frec = ["diario", "semanal", "quincenal", "mensual"].includes(frecuencia)
    ? frecuencia
    : "diario";

  const { valor_cuota, total_pagar, cuotas } = generarCuotas({
    monto: Number(monto),
    tasa: Number(tasa_interes),
    tipo,
    frecuencia: frec,
    num_cuotas: Number(num_cuotas),
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
      monto,
      tasa_interes,
      tipo,
      frec,
      num_cuotas,
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

module.exports = router;
