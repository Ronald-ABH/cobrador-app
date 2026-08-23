const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { db } = require("../db");
const { requireAuth, SECRET } = require("../middleware/auth");

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
};

// La app es de un solo usuario administrador y queda expuesta en una URL
// pública (Railway), así que sin esto el login es un blanco fácil para
// fuerza bruta. Se limita por IP: 10 intentos cada 15 minutos, y los
// intentos que sí llegan a la contraseña correcta no cuentan (skipSuccessfulRequests).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
});

router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "30d" }
  );
  res.cookie("token", token, COOKIE_OPTS);
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Cambiar contraseña (usuario ya autenticado)
router.post("/cambiar-password", requireAuth, (req, res) => {
  const { passwordActual, passwordNueva } = req.body || {};
  if (!passwordActual || !passwordNueva) {
    return res.status(400).json({ error: "Faltan datos" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!bcrypt.compareSync(passwordActual, user.password_hash)) {
    return res.status(401).json({ error: "La contraseña actual no es correcta" });
  }
  const hash = bcrypt.hashSync(passwordNueva, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  res.json({ ok: true });
});

module.exports = router;
