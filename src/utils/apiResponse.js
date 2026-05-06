exports.success = (data, message = "OK") => {
  return {
    success: true,
    message,
    data,
    error: null
  };
};

exports.error = (message = "Erro interno", details = null) => {
  return {
    success: false,
    message,
    data: null,
    error: details
  };
};