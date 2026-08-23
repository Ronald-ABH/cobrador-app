// Copia de seguridad diaria: exporta toda la base de datos a un archivo
// y lo envía por correo como adjunto. Así, aunque algo le pase al servidor,
// siempre hay una copia completa de los datos en el correo configurado.
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { backup: sqliteBackup } = require("node:sqlite");
const { DB_PATH, db } = require("../db");

const DB_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "database")
  : path.join(__dirname, "..", "database");
const BACKUP_DIR = path.join(DB_DIR, "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function crearArchivoBackup() {
  const fecha = new Date().toISOString().slice(0, 10);
  const destino = path.join(BACKUP_DIR, `cobrador-backup-${fecha}.db`);
  // Copia segura de la base de datos completa mientras el servidor sigue funcionando
  await sqliteBackup(db.raw, destino);

  // También generamos una copia en JSON legible por si alguna vez hace falta
  // revisar los datos sin depender de SQLite.
  const data = {
    generado: new Date().toISOString(),
    clientes: db.prepare("SELECT * FROM clientes").all(),
    rutas: db.prepare("SELECT * FROM rutas").all(),
    prestamos: db.prepare("SELECT * FROM prestamos").all(),
    cuotas: db.prepare("SELECT * FROM cuotas").all(),
    pagos: db.prepare("SELECT * FROM pagos").all(),
  };
  const jsonPath = path.join(BACKUP_DIR, `cobrador-backup-${fecha}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  return { destino, jsonPath, fecha };
}

// Railway (y otros proveedores similares) bloquean las conexiones SMTP
// salientes en sus planes básicos, así que en vez de conectarnos
// directamente a Gmail, usamos la API de Resend (https://resend.com), que
// envía el correo por HTTPS normal (igual que cualquier página web), sin
// depender de puertos de correo que puedan estar bloqueados.
async function enviarBackupPorCorreo() {
  const apiKey = process.env.RESEND_API_KEY;
  const destinatarios = process.env.BACKUP_EMAIL_TO;

  if (!apiKey || !destinatarios) {
    console.warn(
      "[backup] RESEND_API_KEY / BACKUP_EMAIL_TO no configurados: no se envió copia por correo."
    );
    return { enviado: false, motivo: "faltan RESEND_API_KEY o BACKUP_EMAIL_TO" };
  }

  const { destino, jsonPath, fecha } = await crearArchivoBackup();
  const dbBase64 = fs.readFileSync(destino).toString("base64");
  const jsonBase64 = fs.readFileSync(jsonPath).toString("base64");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Cobrador App <onboarding@resend.dev>",
      to: [destinatarios],
      subject: `Copia de seguridad Cobrador App - ${fecha}`,
      text: `Copia de seguridad automática generada el ${fecha}.\n\nSe adjuntan dos archivos:\n- cobrador-backup-${fecha}.db (base de datos completa, para restaurar)\n- cobrador-backup-${fecha}.json (los mismos datos en texto legible)`,
      attachments: [
        { filename: `cobrador-backup-${fecha}.db`, content: dbBase64 },
        { filename: `cobrador-backup-${fecha}.json`, content: jsonBase64 },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Resend respondió ${resp.status}: ${errText}`);
  }

  console.log(`[backup] Copia de seguridad enviada por correo (${fecha})`);
  return { enviado: true, fecha };
}

function iniciarBackupProgramado() {
  const expresion = process.env.BACKUP_CRON || "59 23 * * *"; // 11:59pm por defecto
  // Se fija explícitamente la zona horaria de Colombia: sin esto, "11:59pm"
  // se interpreta en la hora local del servidor (en Railway, normalmente
  // UTC), así que el backup terminaría enviándose a media tarde en vez de
  // a las 11:59pm hora Colombia.
  const zona = process.env.APP_TIMEZONE || "America/Bogota";
  cron.schedule(
    expresion,
    () => {
      enviarBackupPorCorreo().catch((err) =>
        console.error("[backup] Error enviando copia de seguridad:", err.message)
      );
    },
    { timezone: zona }
  );
  console.log(`[backup] Copia de seguridad programada diariamente (${expresion}, zona ${zona})`);
}

module.exports = { enviarBackupPorCorreo, iniciarBackupProgramado, crearArchivoBackup, BACKUP_DIR };
