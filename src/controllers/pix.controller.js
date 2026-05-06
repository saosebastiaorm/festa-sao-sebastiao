const pixService = require("../services/pix.service");

async function criarPix(req, res) {
  try {
    const resultado = await pixService.criarPedidoPix(req.body);

    return res.status(200).json(resultado);

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar Pix",
      data: null,
      error: error.message
    });
  }
}

module.exports = {
  criarPix
};