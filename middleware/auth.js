const supabase = require('../config/supabase');

const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // Extract token: "Bearer eyJhbG..." -> "eyJhbG..."
  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Malformed Authorization header' });
  }

  // Verify token with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error("Auth Error:", error?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // SUCCESS: Attach the user object to the request
  // Now, in your routes, use req.user.id instead of req.body.userId
  req.user = user;
  next();
};

module.exports = authenticateUser;
