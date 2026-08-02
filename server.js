require("dotenv").config();
const dns = require("dns");
// Fuerza a Node a preferir IPv4 al resolver direcciones. Algunos servidores
// en la nube (como Railway) no tienen salida IPv6 funcionando, y sin esto
// las conexiones salientes (por ejemplo, al enviar el correo de backup)
// pueden fallar con "Connection timeout".
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");

require("./db"); // inicializa la base de datos y el usuario admin
const { iniciarBackupProgramado } = require("./utils/backup");

const authRoutes = require("./routes/auth");
const clientesRoutes = require("./routes/clientes");
const rutasRoutes = require("./routes/rutas");
const prestamosRoutes = require("./routes/prestamos");
const pagosRoutes = require("./routes/pagos");
const reportesRoutes = require("./routes/reportes");
const sistemaRoutes = require("./routes/sistema");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/rutas", rutasRoutes);
app.use("/api/prestamos", prestamosRoutes);
app.use("/api/pagos", pagosRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/sistema", sistemaRoutes);

// Archivos estáticos del frontend (PWA)
app.use(express.static(path.join(__dirname, "public")));

// Cualquier ruta que no sea /api/* devuelve la app (para que funcione como SPA)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cobrador App escuchando en el puerto ${PORT}`);
  iniciarBackupProgramado();
});
