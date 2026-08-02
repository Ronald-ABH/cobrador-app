const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { enviarBackupPorCorreo } = require("../utils/backup");

const router = express.Router();

// Endpoint público y liviano para servicios de "uptime" (ej. UptimeRobot)
// que visitan la URL cada pocos minutos para que el servidor no se duerma.
router.get("/ping", (req, res) => {
  res.json({ ok: true, hora: new Date().toISOString() });
});

// Forzar el envío de una copia de seguridad manualmente (requiere sesión)
router.post("/backup-ahora", requireAuth, async (req, res) => {
  try {
    const resultado = await enviarBackupPorCorreo();
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo enviar la copia de seguridad: " + err.message });
  }
});

module.exports = router;
