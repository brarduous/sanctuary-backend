const express = require('express');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const router = express.Router();

router.get('/me', authenticateUser, async (req, res, next) => {
  try {
    const { data: memberships, error } = await supabase.from('organization_memberships')
      .select('id,congregation_id,role,campus_id,active,campuses(name),congregations(name)')
      .eq('user_id', req.user.id).eq('active', true).order('created_at');
    if (error) throw error;
    const membershipIds = memberships.map((membership) => membership.id);
    const roles = [...new Set(memberships.map((membership) => membership.role))];
    const [{ data: defaults, error: defaultsError }, { data: overrides, error: overridesError }] = await Promise.all([
      roles.length ? supabase.from('role_capabilities').select('role,capability').in('role', roles) : { data: [], error: null },
      membershipIds.length ? supabase.from('capability_overrides').select('membership_id,capability,allowed').in('membership_id', membershipIds) : { data: [], error: null },
    ]);
    if (defaultsError) throw defaultsError;
    if (overridesError) throw overridesError;
    const data = memberships.map((membership) => {
      const capabilities = new Set(defaults.filter((row) => row.role === membership.role).map((row) => row.capability));
      for (const override of overrides.filter((row) => row.membership_id === membership.id)) override.allowed ? capabilities.add(override.capability) : capabilities.delete(override.capability);
      return { ...membership, capabilities: [...capabilities].sort() };
    });
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
