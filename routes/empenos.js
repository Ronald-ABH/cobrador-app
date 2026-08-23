// Empeños: dinero prestado dejando un objeto en garantía. A propósito es
// un módulo separado de routes/prestamos.js y routes/pagos.js — ni las
// consultas ni los reportes de aquí se mezclan con los de préstamos, para
// que el dinero de un negocio y del otro no se junte.
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { hoyISO, sumarMesesISO } = require("../utils/fecha");

const router = express.Router();
router.use(requireAuth);

// Lista de empeños, con nombre del cliente y si el interés está atrasado
router.get("/", (req, res) => {
  const hoy = hoyISO();
  const empenos = db
    .prepare(
      `SELECT e.*, c.nombre AS cliente_nombre
       FROM empenos e
       JOIN clientes c ON c.id = e.cliente_id
       WHERE c.activo = 1
       ORDER BY (e.estado = 'activo') DESC, e.fecha_proximo_pago ASC`
    )
    .all();

  const conEstado = empenos.map((e) => ({
    ...e,
    atrasado: e.estado === "activo" && e.fecha_proximo_pago < hoy,
  }));
  res.json(conEstado);
});

router.get("/:id", (req, res) => {
  const empeno = db
    .prepare(
      `SELECT e.*, c.nombre AS cliente_nombre, c.telefono, c.direccion
       FROM empenos e JOIN clientes c ON c.id = e.cliente_id
       WHERE e.id = ?`
    )
    .get(req.params.id);
  if (!empeno) return res.status(404).json({ error: "Empeño no encontrado" });

  const pagos = db
    .prepare("SELECT * FROM pagos_empeno WHERE empeno_id = ? ORDER BY fecha DESC")
    .all(req.params.id);

  const hoy = hoyISO();
  res.json({ ...empeno, atrasado: empeno.estado === "activo" && empeno.fecha_proximo_pago < hoy, pagos });
});

router.post("/", (req, res) => {
  const { cliente_id, descripcion, valor, interes_mensual, fecha_inicio, notas } = req.body || {};

  if (!cliente_id || !descripcion || !valor || interes_mensual === undefined || !fecha_inicio) {
    return res.status(400).json({ error: "Faltan datos obligatorios del empeño" });
  }

  const cliente = db.prepare("SELECT id FROM clientes WHERE id = ?").get(cliente_id);
  if (!cliente) return res.status(400).json({ error: "El cliente no existe" });

  const valorNum = Number(valor);
  const interesNum = Number(interes_mensual);
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    return res.status(400).json({ error: "El valor prestado debe ser un número mayor que cero" });
  }
  if (!Number.isFinite(interesNum) || interesNum <= 0) {
    return res.status(400).json({ error: "El interés mensual debe ser un número mayor que cero" });
  }
  if (Number.isNaN(new Date(fecha_inicio + "T00:00:00").getTime())) {
    return res.status(400).json({ error: "La fecha de inicio no es válida" });
  }
  const descripcionTexto = String(descripcion).trim();
  if (!descripcionTexto) {
    return res.status(400).json({ error: "Describe qué se dejó empeñado" });
  }

  const fechaProximoPago = sumarMesesISO(fecha_inicio, 1);

  const info = db
    .prepare(
      `INSERT INTO empenos (cliente_id, descripcion, valor, interes_mensual, fecha_inicio, fecha_proximo_pago, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cliente_id, descripcionTexto, valorNum, interesNum, fecha_inicio, fechaProximoPago, notas || null);

  res.json({ id: info.lastInsertRowid, fecha_proximo_pago: fechaProximoPago });
});

// Registrar el pago del interés mensual. Esto NUNCA toca el valor
// prestado (el capital) — solo "renueva" la prenda un mes más.
router.post("/:id/pago-interes", (req, res) => {
  const empeno = db.prepare("SELECT * FROM empenos WHERE id = ?").get(req.params.id);
  if (!empeno) return res.status(404).json({ error: "Empeño no encontrado" });
  if (empeno.estado !== "activo") {
    return res.status(400).json({ error: "Este empeño ya no está activo" });
  }

  const valorPago = req.body && req.body.valor !== undefined ? Number(req.body.valor) : empeno.interes_mensual;
  if (!Number.isFinite(valorPago) || valorPago <= 0) {
    return res.status(400).json({ error: "El valor del pago debe ser un número mayor que cero" });
  }
  const notas = (req.body && req.body.notas) || null;

  const nuevaFecha = sumarMesesISO(empeno.fecha_proximo_pago, 1);

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO pagos_empeno (empeno_id, tipo, valor, notas) VALUES (?, 'interes', ?, ?)"
    ).run(empeno.id, valorPago, notas);
    db.prepare("UPDATE empenos SET fecha_proximo_pago = ? WHERE id = ?").run(nuevaFecha, empeno.id);
  });
  tx();

  res.json({ ok: true, fecha_proximo_pago: nuevaFecha });
});

// Rescatar la prenda: el cliente paga el valor prestado completo y se
// lleva su objeto. No se cobra el interés del mes en curso.
router.post("/:id/rescatar", (req, res) => {
  const empeno = db.prepare("SELECT * FROM empenos WHERE id = ?").get(req.params.id);
  if (!empeno) return res.status(404).json({ error: "Empeño no encontrado" });
  if (empeno.estado !== "activo") {
    return res.status(400).json({ error: "Este empeño ya no está activo" });
  }

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO pagos_empeno (empeno_id, tipo, valor, notas) VALUES (?, 'rescate', ?, ?)"
    ).run(empeno.id, empeno.valor, (req.body && req.body.notas) || null);
    db.prepare("UPDATE empenos SET estado = 'pagado' WHERE id = ?").run(empeno.id);
  });
  tx();

  res.json({ ok: true });
});

// La prenda se pierde / se remata porque el cliente nunca la rescató.
router.put("/:id/cancelar", (req, res) => {
  db.prepare("UPDATE empenos SET estado = 'cancelado' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Deshacer el último pago de interés o el rescate (por si se registró un
// error). Solo reactiva el empeño si estaba 'pagado' por ese rescate — si
// ya lo habían marcado 'cancelado' aparte, se queda así.
router.delete("/pagos/:pagoId", (req, res) => {
  const pago = db.prepare("SELECT * FROM pagos_empeno WHERE id = ?").get(req.params.pagoId);
  if (!pago) return res.status(404).json({ error: "Pago no encontrado" });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pagos_empeno WHERE id = ?").run(pago.id);

    if (pago.tipo === "interes") {
      const empeno = db.prepare("SELECT * FROM empenos WHERE id = ?").get(pago.empeno_id);
      const fechaAnterior = sumarMesesISO(empeno.fecha_proximo_pago, -1);
      db.prepare("UPDATE empenos SET fecha_proximo_pago = ? WHERE id = ?").run(fechaAnterior, empeno.id);
    } else if (pago.tipo === "rescate") {
      const empeno = db.prepare("SELECT estado FROM empenos WHERE id = ?").get(pago.empeno_id);
      if (empeno && empeno.estado === "pagado") {
        db.prepare("UPDATE empenos SET estado = 'activo' WHERE id = ?").run(pago.empeno_id);
      }
    }
  });
  tx();

  res.json({ ok: true });
});

// Resumen de empeños para su propia tarjeta de reportes — a propósito
// separado de /api/reportes, que es solo de préstamos.
router.get("/reportes/resumen", (req, res) => {
  const capitalActivo = db
    .prepare(
      `SELECT COALESCE(SUM(e.valor),0) AS v
       FROM empenos e JOIN clientes c ON c.id = e.cliente_id
       WHERE e.estado = 'activo' AND c.activo = 1`
    )
    .get().v;

  const interesCobradoHistorico = db
    .prepare(
      `SELECT COALESCE(SUM(pe.valor),0) AS v
       FROM pagos_empeno pe
       JOIN empenos e ON e.id = pe.empeno_id
       JOIN clientes c ON c.id = e.cliente_id
       WHERE pe.tipo = 'interes' AND c.activo = 1`
    )
    .get().v;

  const empenosActivos = db
    .prepare(
      `SELECT COUNT(*) AS n FROM empenos e JOIN clientes c ON c.id = e.cliente_id
       WHERE e.estado = 'activo' AND c.activo = 1`
    )
    .get().n;

  const hoy = hoyISO();
  const atrasados = db
    .prepare(
      `SELECT COUNT(*) AS n FROM empenos e JOIN clientes c ON c.id = e.cliente_id
       WHERE e.estado = 'activo' AND c.activo = 1 AND e.fecha_proximo_pago < ?`
    )
    .get(hoy).n;

  res.json({ capitalActivo, interesCobradoHistorico, empenosActivos, atrasados });
});

module.exports = router;
