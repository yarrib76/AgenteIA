require("./bootstrap/load-env")();

const express = require("express");
const path = require("path");
const routes = require("./routes/index.routes");
const authService = require("./modules/auth/auth.service");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/archivos", express.static(path.join(process.cwd(), "archivos")));
app.use(authService.attachAuth);

app.use("/", routes);

module.exports = app;
