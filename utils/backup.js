// Copia de seguridad diaria: exporta toda la base de datos a un archivo
// y lo envía por correo como adjunto. Así, aunque algo le pase al servidor,
// siempre hay una copia completa de los datos en el correo configurado.
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
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

function getTransporter() {
  const email = process.env.BACKUP_EMAIL_FROM;
  const pass = process.env.BACKUP_EMAIL_APP_PASSWORD;
  if (!email || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: email, pass },
  });
}

async function enviarBackupPorCorreo() {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      "[backup] BACKUP_EMAIL_FROM / BACKUP_EMAIL_APP_PASSWORD no configurados: no se envió copia por correo."
    );
    return { enviado: false, motivo: "faltan credenciales de correo" };
  }

  const destinatarios = process.env.BACKUP_EMAIL_TO || process.env.BACKUP_EMAIL_FROM;
  const { destino, jsonPath, fecha } = await crearArchivoBackup();

  await transporter.sendMail({
    from: process.env.BACKUP_EMAIL_FROM,
    to: destinatarios,
    subject: `Copia de seguridad Cobrador App - ${fecha}`,
    text: `Copia de seguridad automática generada el ${fecha}.\n\nSe adjuntan dos archivos:\n- cobrador-backup-${fecha}.db (base de datos completa, para restaurar)\n- cobrador-backup-${fecha}.json (los mismos datos en texto legible)`,
    attachments: [
      { filename: path.basename(destino), path: destino },
      { filename: path.basename(jsonPath), path: jsonPath },
    ],
  });

  console.log(`[backup] Copia de seguridad enviada por correo (${fecha})`);
  return { enviado: true, fecha };
}

function iniciarBackupProgramado() {
  const expresion = process.env.BACKUP_CRON || "59 23 * * *"; // 11:59pm por defecto
  cron.schedule(expresion, () => {
    enviarBackupPorCorreo().catch((err) =>
      console.error("[backup] Error enviando copia de seguridad:", err.message)
    );
  });
  console.log(`[backup] Copia de seguridad programada diariamente (${expresion})`);
}

module.exports = { enviarBackupPorCorreo, iniciarBackupProgramado, crearArchivoBackup, BACKUP_DIR };
