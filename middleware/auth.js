const supabase = require('../config/supabase');

const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.', requestId: req.requestId } });
  }

  // Extract token: "Bearer eyJhbG..." -> "eyJhbG..."
  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: { code: 'AUTH_INVALID', message: 'Authentication is invalid.', requestId: req.requestId } });
  }

  // Verify token with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error("Auth Error:", error?.message);
    return res.status(401).json({ error: { code: 'AUTH_INVALID', message: 'Authentication is invalid or expired.', requestId: req.requestId } });
  }

  // SUCCESS: Attach the user object to the request
  // Now, in your routes, use req.user.id instead of req.body.userId
  req.user = user;
  next();
};

module.exports = authenticateUser;
