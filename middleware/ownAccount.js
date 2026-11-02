// Authentication establishes identity; ownership is a separate requirement.
function ownAccount(req, res, next) {
  const claimed = req.params?.userId ?? req.body?.userId;
  if (!req.user?.id) return res.status(401).json({ error: { code:'AUTH_REQUIRED', message:'Authentication is required.' } });
  if (claimed !== undefined && claimed !== req.user.id) return res.status(403).json({ error: { code:'FORBIDDEN', message:'You can only access your own account.', requestId:req.requestId } });
  next();
}
module.exports = ownAccount;
