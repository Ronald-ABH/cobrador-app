const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { enviarBackupPorCorreo } = require("../utils/backup");
const { importarCSV } = require("../utils/importarCreditosBYM");

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

// Importar el saldo pendiente actual de los clientes desde la app anterior
// ("créditos b y m"). Es seguro ejecutarlo más de una vez por error: los
// clientes que ya existan (mismo nombre y teléfono) no se duplican, y a un
// cliente que ya tenga un préstamo importado no se le crea otro.
router.post("/importar-clientes", requireAuth, (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Falta el contenido del archivo CSV" });
  }
  try {
    const resumen = importarCSV(csv);
    res.json(resumen);
  } catch (err) {
    console.error("[importar-clientes]", err);
    res.status(400).json({ error: "No se pudo importar el archivo: " + err.message });
  }
});

module.exports = router;
