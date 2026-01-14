const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, 
    message: { error: 'Too many AI requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. General Limiter for other reads (cheap)
// Limit: 100 requests per 15 minutes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: { error: 'Too many requests. Please slow down.' }
});

module.exports = { aiLimiter, generalLimiter };
