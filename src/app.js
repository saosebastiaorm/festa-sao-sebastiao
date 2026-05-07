const express = require("express");
const cors = require("cors");

const pixRoutes = require("./routes/pix.routes");

const app = express();

// CORS LIBERADO
app.use(cors());

// JSON
app.use(express.json());

// ROTAS
app.use("/", pixRoutes);

console.log("APP FPSS CORRETO CARREGADO");

module.exports = app;