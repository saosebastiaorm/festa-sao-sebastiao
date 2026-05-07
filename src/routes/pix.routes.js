const express = require("express");
const router = express.Router();

const pixController = require("../controllers/pix.controller");

// rota principal
router.post("/criar-pix", pixController.criarPix);

module.exports = router;