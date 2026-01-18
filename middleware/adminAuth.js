const supabase = require('../config/supabase');

// Expects authenticateUser to be run FIRST to populate req.user
const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      console.error('Admin Auth Check Failed:', error);
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }

    next();
  } catch (err) {
    console.error('Admin Middleware Error:', err);
    res.status(500).json({ error: 'Server error during authorization.' });
  }
};

module.exports = requireAdmin;