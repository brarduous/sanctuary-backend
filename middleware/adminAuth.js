const supabase = require('../config/supabase');

const syncAdminRoleFromEmail = async (user) => {
  const email = user.email?.trim().toLowerCase();

  if (!email) return false;

  const { data: adminEmail, error: adminEmailError } = await supabase
    .from('admin_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (adminEmailError || !adminEmail) return false;

  const { error: roleSyncError } = await supabase
    .from('user_profiles')
    .upsert({ user_id: user.id, role: 'admin' }, { onConflict: 'user_id' });

  if (roleSyncError) {
    console.error('Admin Role Sync Failed:', roleSyncError);
    return false;
  }

  return true;
};

// Expects authenticateUser to be run FIRST to populate req.user
const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !profile) {
      console.error('Admin Auth Check Failed:', error);
      const synced = await syncAdminRoleFromEmail(req.user);
      return synced ? next() : res.status(403).json({ error: 'Access denied.' });
    }

    if (profile.role !== 'admin') {
      const synced = await syncAdminRoleFromEmail(req.user);
      return synced ? next() : res.status(403).json({ error: 'Admin privileges required.' });
    }

    next();
  } catch (err) {
    console.error('Admin Middleware Error:', err);
    res.status(500).json({ error: 'Server error during authorization.' });
  }
};

module.exports = requireAdmin;
