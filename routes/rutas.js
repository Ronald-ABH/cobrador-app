const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const rutas = db.prepare("SELECT * FROM rutas ORDER BY orden, nombre").all();
  res.json(rutas);
});

router.post("/", (req, res) => {
  const { nombre, orden } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "El nombre de la ruta es obligatorio" });
  const info = db
    .prepare("INSERT INTO rutas (nombre, orden) VALUES (?, ?)")
    .run(nombre, orden || 0);
  res.json({ id: info.lastInsertRowid });
});

router.put("/:id", (req, res) => {
  const { nombre, orden } = req.body || {};
  db.prepare("UPDATE rutas SET nombre = ?, orden = ? WHERE id = ?").run(
    nombre,
    orden || 0,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("UPDATE clientes SET ruta_id = NULL WHERE ruta_id = ?").run(req.params.id);
  db.prepare("DELETE FROM rutas WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
