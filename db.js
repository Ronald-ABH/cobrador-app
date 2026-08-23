// Configuración de la base de datos (SQLite, guardada en un archivo local).
// SQLite guarda todo en un solo archivo (database/cobrador.db) que persiste
// en disco: los datos NO se borran al reiniciar el servidor.
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

// DATA_DIR permite apuntar la base de datos a un disco persistente montado
// por el proveedor de hosting (por ejemplo, un "Volume" de Railway en /data).
// Si no se define, se guarda dentro de la carpeta del proyecto.
const DB_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "database")
  : path.join(__dirname, "database");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, "cobrador.db");
const rawDb = new DatabaseSync(DB_PATH);

// Intenta activar el modo WAL (mejor rendimiento y más resistente a cortes
// de luz). En algunos sistemas de archivos (por ejemplo carpetas sincronizadas
// en la nube) el modo WAL no es compatible, así que si falla seguimos con el
// modo por defecto, que también es seguro.
try {
  rawDb.exec("PRAGMA journal_mode = WAL");
} catch (e) {
  console.warn("[db] No se pudo activar el modo WAL, se usa el modo por defecto:", e.message);
}

// Envoltorio con una API muy parecida a better-sqlite3 (prepare/run/get/all)
// para que el resto del código no tenga que cambiar.
const db = {
  raw: rawDb,
  exec: (sql) => rawDb.exec(sql),
  prepare: (sql) => {
    const stmt = rawDb.prepare(sql);
    return {
      run: (...params) => stmt.run(...params),
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
    };
  },
  transaction: (fn) => {
    return (...args) => {
      rawDb.exec("BEGIN");
      try {
        const result = fn(...args);
        rawDb.exec("COMMIT");
        return result;
      } catch (err) {
        rawDb.exec("ROLLBACK");
        throw err;
      }
    };
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rutas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  orden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  identificacion TEXT,
  telefono TEXT,
  direccion TEXT,
  referencia TEXT,
  notas TEXT,
  ruta_id INTEGER,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ruta_id) REFERENCES rutas(id)
);

CREATE TABLE IF NOT EXISTS prestamos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  monto REAL NOT NULL,
  tasa_interes REAL NOT NULL,
  tipo_interes TEXT NOT NULL DEFAULT 'fijo', -- fijo | saldo | capitalizado
  frecuencia TEXT NOT NULL DEFAULT 'diario', -- diario | semanal | quincenal | mensual
  num_cuotas INTEGER NOT NULL,
  fecha_inicio TEXT NOT NULL,
  valor_cuota REAL NOT NULL,
  total_pagar REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | pagado | cancelado
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prestamo_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  fecha_vencimiento TEXT NOT NULL,
  valor REAL NOT NULL,
  valor_pagado REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagada | parcial | atrasada
  fecha_pago TEXT,
  FOREIGN KEY (prestamo_id) REFERENCES prestamos(id)
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuota_id INTEGER NOT NULL,
  prestamo_id INTEGER NOT NULL,
  valor REAL NOT NULL,
  fecha TEXT DEFAULT (datetime('now')),
  notas TEXT,
  FOREIGN KEY (cuota_id) REFERENCES cuotas(id),
  FOREIGN KEY (prestamo_id) REFERENCES prestamos(id)
);

-- Empeños: dinero prestado dejando un objeto en garantía. Es un negocio
-- aparte de los préstamos normales (no comparten cuotas ni se mezclan en
-- los reportes de dinero): aquí solo se paga un interés fijo mes a mes
-- para mantener la prenda, y el valor prestado se paga completo de una
-- sola vez cuando el cliente la rescata (ahí no se cobra el interés de
-- ese mes).
CREATE TABLE IF NOT EXISTS empenos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  valor REAL NOT NULL,
  interes_mensual REAL NOT NULL,
  fecha_inicio TEXT NOT NULL,
  fecha_proximo_pago TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | pagado | cancelado
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS pagos_empeno (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empeno_id INTEGER NOT NULL,
  tipo TEXT NOT NULL, -- interes | rescate
  valor REAL NOT NULL,
  fecha TEXT DEFAULT (datetime('now')),
  notas TEXT,
  FOREIGN KEY (empeno_id) REFERENCES empenos(id)
);
`);

// Crea el usuario administrador inicial si todavía no existe ningún usuario.
function ensureInitialUser() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
    ).run(username, hash);
    console.log(`Usuario inicial creado -> usuario: "${username}"`);
  }
}
ensureInitialUser();

module.exports = { db, DB_PATH };
