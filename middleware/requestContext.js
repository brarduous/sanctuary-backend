const { randomUUID } = require('crypto');

module.exports = function requestContext(req, res, next) {
  req.requestId = req.get('x-request-id') || randomUUID();
  res.set('x-request-id', req.requestId);
  next();
};
