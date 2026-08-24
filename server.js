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
const empenosRoutes = require("./routes/empenos");

const app = express();

// Railway (y Vercel, si se usa como proxy del frontend) entregan las
// peticiones a través de un proxy inverso. Sin esto, Express ve la IP del
// proxy como si fuera la de todos los visitantes (en vez de la real, que
// viene en X-Forwarded-For), lo que rompería el límite de intentos de
// login: todo el mundo compartiría el mismo contador.
// "1" = confiar solo en el primer proxy (el de la plataforma), no en
// cualquier proxy intermedio que un atacante pudiera inventarse.
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
// El límite por defecto (100kb) no alcanza para subir el CSV de
// importación de clientes desde la app anterior (puede pesar unos pocos
// MB) — se sube un poco el límite para todo el API, que sigue siendo
// razonable para una app de este tamaño.
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/rutas", rutasRoutes);
app.use("/api/prestamos", prestamosRoutes);
app.use("/api/pagos", pagosRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/sistema", sistemaRoutes);
app.use("/api/empenos", empenosRoutes);

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
