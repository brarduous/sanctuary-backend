module.exports = function normalizeErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (res.statusCode < 400) return originalJson(payload);
    const legacy = payload?.error;
    if (legacy && typeof legacy === 'object' && legacy.code && legacy.message) {
      return originalJson({ ...payload, error: { ...legacy, requestId: legacy.requestId || req.requestId } });
    }
    const message = typeof legacy === 'string' ? legacy : 'The request could not be completed.';
    return originalJson({ error: { code: res.statusCode === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED', message, requestId: req.requestId } });
  };
  next();
};
