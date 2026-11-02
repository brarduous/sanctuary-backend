const supabase = require('../config/supabase');
module.exports = async (req,res,next) => {
  const raw=req.query.congregationId;
  if (raw === undefined || ['','null','undefined'].includes(raw)) return next();
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return res.status(400).json({error:'Invalid congregation.'});
  try {
    const id=Number(raw);
    const results=await Promise.all([
      supabase.from('congregation_members').select('member_id').eq('congregation_id',id).eq('user_id',req.user.id).limit(1).maybeSingle(),
      supabase.from('organization_memberships').select('id').eq('congregation_id',id).eq('user_id',req.user.id).eq('active',true).limit(1).maybeSingle(),
      supabase.from('congregations').select('congregation_id').eq('congregation_id',id).eq('leader_user_id',req.user.id).maybeSingle(),
    ]);
    if (results.some(result=>result.error)) throw Error('Membership verification unavailable');
    if (!results.some(result=>result.data)) return res.status(403).json({error:'This prayer feed is available to congregation members.'});
    next();
  } catch { return res.status(503).json({error:'Unable to verify congregation membership. Please try again.'}); }
};
