const mobileAuthService = require("./mobile-auth.service");

async function ensureMobileAuthenticated(req, res, next) {
  try {
    const header = String(req.headers.authorization || "").trim();
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ ok: false, message: "Token requerido." });
    }
    const auth = await mobileAuthService.authenticateToken(token);
    if (!auth) {
      return res.status(401).json({ ok: false, message: "Token invalido o vencido." });
    }
    req.mobileToken = token;
    req.mobileSession = auth.session;
    req.mobileUser = auth.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  ensureMobileAuthenticated,
};
