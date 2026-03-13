const { createHmac, randomBytes, timingSafeEqual } = require("crypto");
const usersService = require("./users.service");

const sessions = new Map();
const SESSION_COOKIE = "agenteia_session";
const CAPTCHA_COOKIE = "agenteia_captcha";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const CAPTCHA_TTL_MS = 1000 * 60 * 10;

function normalizeText(value) {
  return String(value || "").trim();
}

function getSessionSecret() {
  return (
    normalizeText(process.env.AUTH_SESSION_SECRET)
    || normalizeText(process.env.APP_SECRET)
    || "change-me-auth-session-secret"
  );
}

function signValue(value) {
  return createHmac("sha256", getSessionSecret()).update(String(value || "")).digest("hex");
}

function encodeSignedValue(rawValue) {
  const value = String(rawValue || "");
  return `${value}.${signValue(value)}`;
}

function decodeSignedValue(input) {
  const raw = normalizeText(input);
  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  const value = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  const expected = signValue(value);
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return null;
  if (!timingSafeEqual(left, right)) return null;
  return value;
}

function parseCookies(headerValue) {
  const raw = String(headerValue || "");
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return acc;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  parts.push(`Path=${options.path || "/"}`);
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function appendCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", current.concat(cookieValue));
    return;
  }
  res.setHeader("Set-Cookie", [current, cookieValue]);
}

function createSession(userId) {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

function deleteSession(sessionId) {
  if (sessionId) sessions.delete(sessionId);
}

async function resolveSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  const signedSession = cookies[SESSION_COOKIE];
  const sessionId = decodeSignedValue(signedSession || "");
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const user = await usersService.getUserById(session.userId);
  if (!user) {
    sessions.delete(sessionId);
    return null;
  }
  req.authSessionId = sessionId;
  return user;
}

function setLoginSession(res, userId) {
  const sessionId = createSession(userId);
  appendCookie(
    res,
    serializeCookie(SESSION_COOKIE, encodeSignedValue(sessionId), {
      maxAge: SESSION_TTL_MS / 1000,
    })
  );
}

function clearLoginSession(req, res) {
  const cookies = req.cookies || parseCookies(req.headers.cookie);
  const sessionId = decodeSignedValue(cookies[SESSION_COOKIE] || "");
  deleteSession(sessionId);
  appendCookie(res, serializeCookie(SESSION_COOKIE, "", { maxAge: 0 }));
}

function buildCaptchaChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  return {
    prompt: `${a} + ${b}`,
    answer: String(a + b),
    nonce: randomBytes(10).toString("hex"),
  };
}

function setCaptcha(res, challenge) {
  const payload = JSON.stringify({
    answer: challenge.answer,
    nonce: challenge.nonce,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });
  appendCookie(
    res,
    serializeCookie(CAPTCHA_COOKIE, encodeSignedValue(payload), {
      maxAge: CAPTCHA_TTL_MS / 1000,
    })
  );
}

function consumeCaptcha(req, res, answer) {
  const cookies = req.cookies || parseCookies(req.headers.cookie);
  const raw = decodeSignedValue(cookies[CAPTCHA_COOKIE] || "");
  appendCookie(res, serializeCookie(CAPTCHA_COOKIE, "", { maxAge: 0 }));
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.expiresAt < Date.now()) return false;
    return normalizeText(parsed.answer) === normalizeText(answer);
  } catch (error) {
    return false;
  }
}

async function attachAuth(req, res, next) {
  try {
    req.currentUser = await resolveSessionUser(req);
    req.isAuthenticated = Boolean(req.currentUser);
    req.hasUsers = await usersService.hasAnyUsers();
    res.locals.currentUser = req.currentUser || null;
    res.locals.isAuthenticated = req.isAuthenticated;
    res.locals.hasUsers = req.hasUsers;
    next();
  } catch (error) {
    next(error);
  }
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated) return next();
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.path || "").startsWith("/api/");
  if (wantsJson) {
    return res.status(401).json({ ok: false, message: "Debes iniciar sesión." });
  }
  const redirect = encodeURIComponent(req.originalUrl || "/");
  return res.redirect(`/login?next=${redirect}`);
}

function ensureRegistrationAllowed(req, res, next) {
  if (!req.hasUsers || req.isAuthenticated) return next();
  return res.redirect("/login");
}

module.exports = {
  attachAuth,
  buildCaptchaChallenge,
  clearLoginSession,
  consumeCaptcha,
  ensureAuthenticated,
  ensureRegistrationAllowed,
  parseCookies,
  setCaptcha,
  setLoginSession,
};
