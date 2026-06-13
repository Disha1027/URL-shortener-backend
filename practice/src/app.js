const express = require("express");
const routes = require("./routes");

const app = express();

app.set("trust proxy", true);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(routes);

module.exports = app;