const supabase = require('../config/supabase');

function congregationIdFrom(req) {
  return req.params.congregationId || req.body?.congregationId || req.query?.congregationId;
}

function requireCapability(capability, options = {}) {
  return async (req, res, next) => {
    const congregationId = options.getCongregationId?.(req) || congregationIdFrom(req);
    if (!congregationId) {
      return res.status(400).json({ error: { code: 'CONGREGATION_REQUIRED', message: 'Congregation context is required.', requestId: req.requestId } });
    }

    const { data, error } = await supabase.rpc('has_congregation_capability', {
      requested_congregation_id: Number(congregationId),
      requested_capability: capability,
      requested_user_id: req.user.id,
      requested_campus_id: req.body?.campusId || req.query?.campusId || null,
    });

    if (error) {
      // During the additive rollout, retain the current leader contract if the
      // capability RPC has not been installed yet. Never broaden beyond it.
      if (['PGRST202', '42883'].includes(error.code)) {
        const { data: congregation, error: legacyError } = await supabase
          .from('congregations')
          .select('leader_user_id')
          .eq('congregation_id', congregationId)
          .single();
        if (legacyError) return next(legacyError);
        if (congregation?.leader_user_id === req.user.id) {
          req.congregationId = Number(congregationId);
          req.capability = capability;
          req.authorizationMode = 'legacy_leader_compatibility';
          return next();
        }
      } else {
        return next(error);
      }
    }
    if (!data) {
      // The RPC can exist before legacy leaders are backfilled. Preserve their
      // current access until membership coverage is verified at 100%.
      const { data: congregation, error: legacyError } = await supabase
        .from('congregations')
        .select('leader_user_id')
        .eq('congregation_id', congregationId)
        .maybeSingle();
      if (legacyError) return next(legacyError);
      if (congregation?.leader_user_id !== req.user.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.', requestId: req.requestId } });
      }
      req.authorizationMode = 'legacy_leader_compatibility';
    }

    req.congregationId = Number(congregationId);
    req.capability = capability;
    next();
  };
}

module.exports = { congregationIdFrom, requireCapability };
