const supabase = require('../config/supabase');

const optionalAuthenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // 1. If no header, just proceed as guest (req.user will be undefined)
  if (!authHeader) {
    return next();
  }

  // 2. If header exists, try to process it
  const token = authHeader.split(' ')[1];
  if (!token) return next();

  // 3. Verify with Supabase, but strictly ignore errors (treat as guest on fail)
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (!error && user) {
    req.user = user; // Attach user if valid
  }
  
  // 4. Always proceed
  next();
};

module.exports = optionalAuthenticateUser;