const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-secret-cambia-esto";

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

module.exports = { requireAuth, SECRET };
