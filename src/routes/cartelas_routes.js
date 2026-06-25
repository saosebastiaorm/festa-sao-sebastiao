const express = require("express");
const router = express.Router();

const cartelasController = require("../controllers/cartelas.controller");

router.post("/validar-numero", cartelasController.validarNumero);
router.post("/pix-fisica", cartelasController.criarPixFisica);
router.post("/pix-digital", cartelasController.criarPixDigital);
router.get("/verificar-pagamento/:txid", cartelasController.statusPagamento);

module.exports = router;
