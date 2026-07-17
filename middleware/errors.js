function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', requestId: req.requestId } });
}

function errorHandler(error, req, res, _next) {
  console.error(`[${req.requestId}]`, error);
  const status = error.status || 500;
  res.status(status).json({
    error: {
      code: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message: status === 500 ? 'The request could not be completed.' : error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      requestId: req.requestId,
    },
  });
}

module.exports = { notFound, errorHandler };
