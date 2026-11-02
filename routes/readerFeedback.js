const express=require('express'),rateLimit=require('express-rate-limit');
const {contentKey,validateFeedback,availableContent}=require('../services/readerFeedback');
function createReaderFeedbackRouter({db,authenticateUser,now=()=>new Date()}){
 const router=express.Router();router.use(authenticateUser);
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 const limiter=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});
 router.use(limiter);
 router.route('/:type/:id').get(async(req,res,next)=>{
  try{const id=contentKey(req.params.type,req.params.id);if(!await availableContent(db,req.user.id,req.params.type,id,now()))return res.status(404).json({error:'Content not found.'});const result=await db.from('reader_content_feedback').select('rating,clarity,relevance,practice_feasible,issue_tags,channel,updated_at').eq('user_id',req.user.id).eq('content_type',req.params.type).eq('content_id',id).maybeSingle();if(result.error)throw result.error;const row=result.data;res.json({feedback:row?{rating:row.rating,clarity:row.clarity,relevance:row.relevance,practice_feasible:row.practice_feasible,issue_tags:row.issue_tags,channel:row.channel,updated_at:row.updated_at}:null});}catch(error){next(error);}
 }).put(async(req,res,next)=>{
  try{if(req.body?.userId!==undefined&&req.body.userId!==req.user.id)return res.status(403).json({error:'Account access denied.'});const id=contentKey(req.params.type,req.params.id),feedback=validateFeedback(req.body);if(!await availableContent(db,req.user.id,req.params.type,id,now()))return res.status(404).json({error:'Content not found.'});const result=await db.from('reader_content_feedback').upsert({user_id:req.user.id,content_type:req.params.type,content_id:id,...feedback,updated_at:now().toISOString()},{onConflict:'user_id,content_type,content_id'});if(result.error)throw result.error;res.json({saved:true});}catch(error){next(error);}
 }).delete(async(req,res,next)=>{
  try{const id=contentKey(req.params.type,req.params.id);const result=await db.from('reader_content_feedback').delete().eq('user_id',req.user.id).eq('content_type',req.params.type).eq('content_id',id);if(result.error)throw result.error;res.status(204).end();}catch(error){next(error);}
 });
 router.use((error,_req,res,_next)=>res.status(error.status || 503).json({error:error.status===400?error.message:'Unable to save or load feedback. Please try again.'}));
 return router;
}
module.exports={createReaderFeedbackRouter};
