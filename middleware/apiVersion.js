const { logEvent } = require('../utils/helpers');

const VERSIONED_PREFIX = '/api/v1';
const legacyPrefixes = [
  '/advice',
  '/analysis',
  '/bible-studies',
  '/community',
  '/events',
  '/kiosk',
  '/messages',
  '/news',
  '/prayers',
  '/sermons',
  '/stripe',
  '/user',
  '/videos',
  '/volunteers',
  '/api/ai',
  '/api/authorization',
  '/api/care',
  '/api/congregations',
  '/api/crm',
  '/api/exports',
  '/api/giving',
  '/api/music',
  '/api/recovery',
  '/api/staff',
  '/api/transcribe',
];

function apiVersion(req, res, next) {
  if (req.path.startsWith(VERSIONED_PREFIX)) {
    req.apiVersion = 'v1';
    res.set('API-Version', 'v1');
    return next();
  }

  const legacyPrefix = legacyPrefixes.find((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));
  if (!legacyPrefix) {
    return next();
  }

  req.apiVersion = 'legacy';
  res.set('API-Version', 'legacy');
  res.set('X-API-Deprecated', 'true');
  res.on('finish', () => {
    logEvent('info', 'backend', req.headers['x-user-id'] || null, 'api_legacy_request', `${req.method} ${legacyPrefix}`, {
      requestId: req.requestId,
      statusCode: res.statusCode,
    });
  });
  return next();
}

module.exports = apiVersion;
