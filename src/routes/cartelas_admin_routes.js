const express = require("express");
const router = express.Router();

const cartelasController = require("../controllers/cartelas.controller");

// GET https://api.festasaosebastiao.com.br/admin/cartelas/buscar/:numero
router.get("/buscar/:numero", cartelasController.buscarPorNumero);

module.exports = router;
