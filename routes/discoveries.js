const express = require('express');
const rateLimit = require('express-rate-limit');
const { createHash } = require('node:crypto');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const requireAdmin = require('../middleware/adminAuth');
const { UUID, invalid, date, validateContent, validateReview, validateCompletion, publicDiscovery, localDate, shiftDate, cohort } = require('../utils/discoveries');
const router = express.Router();
const adminRouter = express.Router();
const readLimiter = rateLimit({ windowMs: 15 * 60000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 3600000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const metricLimiter = rateLimit({ windowMs: 15 * 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const METRICS = new Set(['card_viewed','question_opened','answer_committed','direct_reveal','explanation_viewed','source_opened','share_initiated','app_cta_clicked']);
const REVISION_FIELDS = 'discovery_id,revision,content';
function unwrap(result) {
  if (result.error) {
    if (['23503','23505'].includes(result.error.code)) {result.error.status=409;result.error.message='This action conflicts with the current revision, approval, or schedule.';}
    if (result.error.code==='P0001') {result.error.status=400;result.error.message='This action is not valid for the discovery’s current revision or status.';}
    throw result.error;
  }
  return result.data;
}
function itemId(value) { if (!UUID.test(value)) invalid('A discovery UUID is required.'); return value; }
function revision(value) { if (!Number.isInteger(value) || value < 1) invalid('A positive revision is required.'); return value; }
function missingSchema(error) { return ['42P01','PGRST205'].includes(error?.code); }
async function settings() {
  const result = await supabase.from('discovery_runtime_settings').select('*').eq('singleton', true).maybeSingle();
  if (missingSchema(result.error)) return { enabled: false, rollout_percentage: 0, internal_user_ids: [] };
  return unwrap(result) || { enabled: false, rollout_percentage: 0, internal_user_ids: [] };
}
async function projectSchedule(schedule) {
  if (!schedule.length) return [];
  const ids = [...new Set(schedule.map(row => row.discovery_id))];
  const [revisionsResult, parentResult] = await Promise.all([
    supabase.from('discovery_revisions').select(REVISION_FIELDS).in('discovery_id', ids),
    supabase.from('discoveries').select('id,withdrawn,correction_notice').in('id', ids),
  ]);
  const revisions = unwrap(revisionsResult);
  const parents = new Map(unwrap(parentResult).map(row => [row.id, row]));
  return schedule.flatMap(row => {
    const parent = parents.get(row.discovery_id);
    const content = revisions.find(candidate => candidate.discovery_id === row.discovery_id && candidate.revision === row.revision);
    return !parent || parent.withdrawn || !content ? [] : [{ ...publicDiscovery(content, row.publication_date), ...(row.position ? {setPosition:row.position,setDifficulty:['easy','medium','hard'][row.position-1]}:{}), correctionNotice: parent.correction_notice || null }];
  });
}
async function releasedRows(id, rev) {
  const cutoff = localDate(new Date(),'Pacific/Kiritimati');
  const queries = ['discovery_schedule','discovery_publication_history','discovery_daily_set_items'].map(table => {
    let query = supabase.from(table).select(`publication_date,discovery_id,revision${table==='discovery_daily_set_items' ? ',position':''}`).eq('discovery_id',id).lte('publication_date',cutoff);
    if (rev) query = query.eq('revision',rev);
    return query.order('publication_date',{ascending:false}).limit(100);
  });
  return (await Promise.all(queries)).flatMap(result=>missingSchema(result.error) ? []:unwrap(result)).sort((a,b) => b.publication_date.localeCompare(a.publication_date) || b.revision-a.revision);
}
async function dailySetRows(today,requestedDate) {
  const scheduled=unwrap(await supabase.from('discovery_daily_set_items').select('publication_date,discovery_id,revision,position').gte('publication_date',requestedDate || shiftDate(today,-1)).lte('publication_date',requestedDate || shiftDate(today,7)).order('publication_date').order('position'));
  const projected=await projectSchedule(scheduled);
  // A withdrawn/missing question hides its whole set, never silently substitutes
  // another puzzle or changes the Easy → Medium → Hard result order.
  return projected.filter(item=>projected.filter(other=>other.publicationDate===item.publicationDate).length===3);
}
router.get('/bundle', readLimiter, optionalAuth, async (req, res, next) => {
  try {
    const today = localDate(new Date(), String(req.query.timeZone || 'UTC'));
    const requestedDate=req.query.date;
    if(requestedDate!==undefined && (!date(requestedDate) || requestedDate>today))invalid('Choose a released daily trivia date.');
    const installationId = UUID.test(req.query.installationId) ? req.query.installationId : 'unassigned';
    const runtime = await settings();
    const enabled = runtime.enabled && ((req.user && runtime.internal_user_ids.includes(req.user.id)) || cohort(req.user?.id || installationId) < runtime.rollout_percentage);
    let items = [];
    let evergreen = [];
    let withdrawnIds = [];
    const dailySet=req.query.dailySet==='1';
    if (enabled && dailySet) {
      const [daily,withdrawn]=await Promise.all([dailySetRows(today,requestedDate),supabase.from('discoveries').select('id').eq('withdrawn',true).limit(1000)]);
      items=daily;withdrawnIds=unwrap(withdrawn).map(row=>row.id);
    } else if (enabled) {
      const [scheduled, fallback, withdrawn] = await Promise.all([
        supabase.from('discovery_schedule').select('publication_date,discovery_id,revision').gte('publication_date', shiftDate(today,-1)).lte('publication_date',shiftDate(today,7)).order('publication_date'),
        supabase.from('discovery_schedule').select('publication_date,discovery_id,revision').lte('publication_date',today).order('publication_date',{ascending:false}).limit(10),
        supabase.from('discoveries').select('id').eq('withdrawn',true).limit(1000),
      ]);
      [items, evergreen] = await Promise.all([projectSchedule(unwrap(scheduled)),projectSchedule(unwrap(fallback))]);
      evergreen = evergreen.slice(0,1);
      withdrawnIds = unwrap(withdrawn).map(row => row.id);
    }
    const body = { schemaVersion: 1, enabled: Boolean(enabled), items, evergreen, withdrawnIds };
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
    res.set('Cache-Control','private, no-cache');
    res.set('ETag',etag);
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.json({ ...body, bundleRevision: etag.slice(1,-1), serverTime: new Date().toISOString() });
  } catch (error) { next(error); }
});
router.post('/completions', auth, async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.events) || !req.body.events.length || req.body.events.length > 50) invalid('Submit between one and fifty events.');
    const events = req.body.events.map(validateCompletion);
    const results = unwrap(await supabase.rpc('discovery_complete', { p_user: req.user.id, p_events: events }));
    res.set('Cache-Control','no-store').json({ results });
  } catch (error) { next(error); }
});
router.get('/progress', auth, async (req,res,next) => {
  try {
    const result = await supabase.from('discovery_completions').select('*',{count:'exact'}).eq('user_id',req.user.id).order('received_at',{ascending:false}).limit(200);
    const completions = unwrap(result);
    res.set('Cache-Control','no-store').json({ total: result.count || 0, completions });
  } catch (error) { next(error); }
});
router.post('/metrics', metricLimiter, async (req,res,next) => {
  try {
    const { eventId, discoveryId, event, platform } = req.body;
    if (!UUID.test(eventId) || !UUID.test(discoveryId) || !METRICS.has(event) || !['mobile','web'].includes(platform)) invalid('Invalid metric.');
    const scheduled = await releasedRows(discoveryId);
    if (scheduled.length) unwrap(await supabase.from('discovery_metrics').upsert({event_id:eventId,discovery_id:discoveryId,event,platform},{onConflict:'event_id',ignoreDuplicates:true}));
    res.sendStatus(204);
  } catch (error) { next(error); }
});
router.get('/:id',readLimiter, async (req,res,next) => {
  try {
    const id = itemId(req.params.id);
    const schedule = (await releasedRows(id)).slice(0,1);
    if (!schedule.length) return res.status(404).json({error:{code:'DISCOVERY_UNAVAILABLE',message:'This discovery is unavailable.'}});
    const items = await projectSchedule(schedule);
    if (!items.length) return res.status(410).json({error:{code:'DISCOVERY_WITHDRAWN',message:'This discovery has been withdrawn for review.'}});
    // Revalidate on every online visit so a withdrawal/correction is respected.
    res.set('Cache-Control','no-store').json({ discovery: items[0] });
  } catch(error) { next(error); }
});
router.post('/:id/reports',reportLimiter,optionalAuth,async (req,res,next) => {
  try {
    const id = itemId(req.params.id);
    const rev = revision(req.body.revision);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 2000) invalid('Describe the issue in 10–2000 characters.');
    const schedule = await releasedRows(id,rev);
    if (!schedule.length) return res.sendStatus(404);
    unwrap(await supabase.from('discovery_issue_reports').insert({discovery_id:id,revision:rev,user_id:req.user?.id || null,reason}));
    res.status(201).json({received:true});
  } catch(error) { next(error); }
});

adminRouter.use(auth,requireAdmin);
adminRouter.get('/curriculum',async (_req,res,next)=>{
  try {
    const [runs,attempts,plans]=await Promise.all([
      supabase.from('discovery_generation_runs').select('*').order('started_at',{ascending:false}).limit(20),
      supabase.from('discovery_generation_attempts').select('*').order('created_at',{ascending:false}).limit(100),
      supabase.from('discovery_week_plans').select('*').order('start_date',{ascending:false}).limit(12),
    ]);
    res.set('Cache-Control','no-store').json({runs:unwrap(runs),attempts:unwrap(attempts),plans:unwrap(plans)});
  }catch(error){next(error);}
});
adminRouter.post('/curriculum/:date/retry',async (req,res,next)=>{
  try {
    if(!date(req.params.date))invalid('A valid curriculum date is required.');
    unwrap(await supabase.rpc('discovery_curriculum_retry',{p_date:req.params.date,p_actor:req.user.id}));
    res.json({reset:true,date:req.params.date});
  }catch(error){next(error);}
});
adminRouter.get('/',async (_req,res,next) => {
  try {
    const [revisions, reviews, schedule, reports] = await Promise.all([
      supabase.from('discovery_revisions').select('*').order('created_at',{ascending:false}).limit(300),
      supabase.from('discovery_reviews').select('*').order('reviewed_at',{ascending:false}).limit(300),
      supabase.from('discovery_schedule').select('*').order('publication_date',{ascending:false}).limit(120),
      supabase.from('discovery_issue_reports').select('*').order('created_at',{ascending:false}).limit(100),
    ]);
    const availableDates = new Set((await projectSchedule(unwrap(schedule))).map(item => item.publicationDate));
    let daysAhead=0;
    while (availableDates.has(shiftDate(localDate(),daysAhead))) daysAhead++;
    res.set('Cache-Control','no-store').json({revisions:unwrap(revisions),reviews:unwrap(reviews),schedule:schedule.data,reports:unwrap(reports),scheduledDaysAhead:daysAhead,runwayWarning:daysAhead < 14,settings:await settings()});
  } catch(error) { next(error); }
});
adminRouter.get('/:id/revisions/:revision',async (req,res,next) => {
  try {
    const row = unwrap(await supabase.from('discovery_revisions').select('*').eq('discovery_id',itemId(req.params.id)).eq('revision',revision(Number(req.params.revision))).maybeSingle());
    if (!row) return res.sendStatus(404);
    res.set('Cache-Control','no-store').json({revision:row,preview:publicDiscovery(row,null)});
  } catch(error) { next(error); }
});
adminRouter.post('/import',async (req,res,next) => {
  try {
    const {id,slug,content} = req.body;
    itemId(id);
    if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{2,79}$/.test(slug)) invalid('A stable slug is required.');
    const validated = validateContent(content);
    const rev = unwrap(await supabase.rpc('discovery_import',{p_id:id,p_slug:slug,p_content:validated,p_actor:req.user.id}));
    res.status(201).json({id,revision:rev,status:'in_review'});
  } catch(error) { next(error); }
});
adminRouter.post('/:id/approve',async (req,res,next) => {
  try {
    const id = itemId(req.params.id), rev = revision(req.body.revision);
    const review = validateReview(req.body);
    const row = unwrap(await supabase.from('discovery_revisions').select(REVISION_FIELDS).eq('discovery_id',id).eq('revision',rev).single());
    validateContent(row.content);
    unwrap(await supabase.rpc('discovery_approve',{p_id:id,p_revision:rev,p_actor:req.user.id,p_note:review.note,p_attestations:review.attestations}));
    res.json({approved:true,id,revision:rev});
  } catch(error) { next(error); }
});
adminRouter.post('/:id/schedule',async (req,res,next) => {
  try {
    if (!date(req.body.date)) invalid('An ISO publication date is required.');
    unwrap(await supabase.rpc('discovery_schedule_item',{p_id:itemId(req.params.id),p_revision:revision(req.body.revision),p_date:req.body.date,p_actor:req.user.id}));
    res.json({scheduled:true});
  } catch(error) { next(error); }
});
adminRouter.post('/:id/withdraw',async (req,res,next) => {
  try {
    const notice = typeof req.body.notice === 'string' ? req.body.notice.trim() : '';
    if (notice.length < 10 || notice.length > 1000) invalid('A correction/review notice is required.');
    const rows = unwrap(await supabase.from('discoveries').update({withdrawn:true,correction_notice:notice,withdrawn_at:new Date().toISOString(),withdrawn_by:req.user.id}).eq('id',itemId(req.params.id)).select('id'));
    if (!rows.length) return res.sendStatus(404);
    res.json({withdrawn:true});
  } catch(error) { next(error); }
});
adminRouter.post('/:id/restore',async (req,res,next) => {
  try {
    const notice=typeof req.body.notice==='string' ? req.body.notice.trim() : '';
    if (notice.length < 10 || notice.length > 1000) invalid('A public correction notice is required.');
    unwrap(await supabase.rpc('discovery_restore',{p_id:itemId(req.params.id),p_revision:revision(req.body.revision),p_actor:req.user.id,p_notice:notice}));
    res.json({restored:true});
  } catch(error) {next(error);}
});
adminRouter.post('/settings',async (req,res,next) => {
  try {
    const {enabled,rolloutPercentage,internalUserIds} = req.body;
    if (typeof enabled !== 'boolean' || !Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100 || !Array.isArray(internalUserIds) || internalUserIds.length > 100 || internalUserIds.some(id => !UUID.test(id))) invalid('Invalid rollout settings.');
    unwrap(await supabase.from('discovery_runtime_settings').update({enabled,rollout_percentage:rolloutPercentage,internal_user_ids:internalUserIds}).eq('singleton',true));
    res.json({updated:true});
  } catch(error) { next(error); }
});
module.exports = {router,adminRouter};
