const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Lista de clientes, con totales de deuda pendiente calculados al vuelo
router.get("/", (req, res) => {
  const clientes = db
    .prepare(
      `SELECT c.*, r.nombre AS ruta_nombre
       FROM clientes c
       LEFT JOIN rutas r ON r.id = c.ruta_id
       WHERE c.activo = 1
       ORDER BY c.nombre`
    )
    .all();

  const deudaStmt = db.prepare(`
    SELECT COALESCE(SUM(cu.valor - cu.valor_pagado), 0) AS deuda
    FROM cuotas cu
    JOIN prestamos p ON p.id = cu.prestamo_id
    WHERE p.cliente_id = ? AND p.estado = 'activo' AND cu.estado != 'pagada'
  `);

  const result = clientes.map((c) => ({
    ...c,
    deuda_pendiente: deudaStmt.get(c.id).deuda,
  }));

  res.json(result);
});

router.get("/:id", (req, res) => {
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(req.params.id);
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
  const prestamos = db
    .prepare("SELECT * FROM prestamos WHERE cliente_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json({ ...cliente, prestamos });
});

router.post("/", (req, res) => {
  const { nombre, identificacion, telefono, direccion, referencia, notas, ruta_id } =
    req.body || {};
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });
  const info = db
    .prepare(
      `INSERT INTO clientes (nombre, identificacion, telefono, direccion, referencia, notas, ruta_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nombre,
      identificacion || null,
      telefono || null,
      direccion || null,
      referencia || null,
      notas || null,
      ruta_id || null
    );
  res.json({ id: info.lastInsertRowid });
});

router.put("/:id", (req, res) => {
  const { nombre, identificacion, telefono, direccion, referencia, notas, ruta_id } =
    req.body || {};
  if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" });
  db.prepare(
    `UPDATE clientes SET nombre=?, identificacion=?, telefono=?, direccion=?, referencia=?, notas=?, ruta_id=?
     WHERE id = ?`
  ).run(
    nombre,
    identificacion || null,
    telefono || null,
    direccion || null,
    referencia || null,
    notas || null,
    ruta_id || null,
    req.params.id
  );
  res.json({ ok: true });
});

// Borrado lógico (no se elimina la información, solo se marca inactivo)
router.delete("/:id", (req, res) => {
  db.prepare("UPDATE clientes SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
