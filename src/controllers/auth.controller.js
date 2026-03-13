const authService = require("../modules/auth/auth.service");
const usersService = require("../modules/auth/users.service");

function normalizeText(value) {
  return String(value || "").trim();
}

function buildRegisterViewModel({
  currentUser = null,
  error = "",
  email = "",
  next = "/",
  success = "",
  challenge,
}) {
  return {
    currentUser,
    error,
    email,
    next,
    success,
    challenge,
  };
}

function renderRegister(res, req, viewModel, statusCode = 200) {
  if (req.isAuthenticated) {
    return res.status(statusCode).render("layouts/main", {
      pageTitle: "Usuarios - Nuevo",
      activeMenu: "users-new",
      headerTitle: "Nuevo Usuario",
      moduleView: "auth-register",
      moduleData: viewModel,
      pageScripts: [],
    });
  }
  return res.status(statusCode).render("layouts/auth", {
    pageTitle: "Crear primer usuario",
    authView: "auth-register",
    authData: viewModel,
  });
}

async function renderLoginPage(req, res) {
  if (req.isAuthenticated) {
    return res.redirect("/");
  }
  return res.render("layouts/auth", {
    pageTitle: "Ingresar",
    authView: "auth-login",
    authData: {
      error: normalizeText(req.query.error),
      next: normalizeText(req.query.next) || "/",
      email: normalizeText(req.query.email),
      hasUsers: req.hasUsers,
    },
  });
}

async function login(req, res) {
  const email = normalizeText(req.body.email);
  const password = String(req.body.password || "");
  const next = normalizeText(req.body.next) || "/";
  const user = await usersService.authenticateUser({ email, password });
  if (!user) {
    return res.status(401).render("layouts/auth", {
      pageTitle: "Ingresar",
      authView: "auth-login",
      authData: {
        error: "Email o contraseña incorrectos.",
        next,
        email,
        hasUsers: req.hasUsers,
      },
    });
  }

  authService.setLoginSession(res, user.id);
  return res.redirect(next);
}

async function logout(req, res) {
  authService.clearLoginSession(req, res);
  return res.redirect("/login");
}

async function renderRegisterPage(req, res) {
  const challenge = authService.buildCaptchaChallenge();
  authService.setCaptcha(res, challenge);
  const viewModel = buildRegisterViewModel({
    currentUser: req.currentUser,
    next: normalizeText(req.query.next) || "/",
    success: normalizeText(req.query.success),
    challenge,
  });
  return renderRegister(res, req, viewModel);
}

async function register(req, res) {
  const email = normalizeText(req.body.email);
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const captchaAnswer = normalizeText(req.body.captchaAnswer);
  const next = normalizeText(req.body.next) || "/";

  const challenge = authService.buildCaptchaChallenge();
  authService.setCaptcha(res, challenge);

  if (password !== confirmPassword) {
    return renderRegister(res, req, buildRegisterViewModel({
        currentUser: req.currentUser,
        error: "Las contraseñas no coinciden.",
        email,
        next,
        challenge,
      }), 400);
  }

  if (!authService.consumeCaptcha(req, res, captchaAnswer)) {
    authService.setCaptcha(res, challenge);
    return renderRegister(res, req, buildRegisterViewModel({
        currentUser: req.currentUser,
        error: "Captcha inválido o vencido.",
        email,
        next,
        challenge,
      }), 400);
  }

  try {
    const user = await usersService.createUser({
      email,
      password,
      createdByUserId: req.currentUser ? req.currentUser.id : null,
    });

    if (!req.currentUser) {
      authService.setLoginSession(res, user.id);
      return res.redirect(next);
    }

    return res.redirect("/usuarios/nuevo?success=Usuario creado correctamente.");
  } catch (error) {
    authService.setCaptcha(res, challenge);
    return renderRegister(res, req, buildRegisterViewModel({
        currentUser: req.currentUser,
        error: error.message,
        email,
        next,
        challenge,
      }), 400);
  }
}

module.exports = {
  login,
  logout,
  register,
  renderLoginPage,
  renderRegisterPage,
};
