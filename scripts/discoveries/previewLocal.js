// Isolated demonstration only. Uses synthetic editorial approvals in an in-memory
// PostgreSQL instance. No Supabase credentials, production reads, or persistent writes.
if (process.env.NODE_ENV==='production') throw new Error('Local discovery preview is disabled in production.');
const {createHarness,seedReviewed}=require('../../test/helpers/discoveryHarness');
const {localDate,shiftDate}=require('../../utils/discoveries');
const entries=require('../../content/discoveries/biblical-candidates.json');
(async()=>{
 const previewIndex=Number(process.env.DISCOVERY_PREVIEW_INDEX || 0);
 if(!Number.isInteger(previewIndex) || previewIndex<0 || previewIndex>=entries.length)throw new Error('Invalid local preview question index.');
 const ordered=[entries[previewIndex],...entries.filter((_,index)=>index!==previewIndex)];
 const h=await createHarness({listen:true,port:4013});
 for(let index=0;index<ordered.length;index++) {
  // Synthetic UI fixtures, not a production assessment or editorial decision.
  const scores=[1,4,7];const levels=['easy','moderate','challenging'];
  const demo={...ordered[index],content:{...ordered[index].content,difficulty:ordered[index].content.difficulty || {rubricVersion:'discovery-difficulty-v1',level:levels[index%3],score:scores[index%3]}}};
  await seedReviewed(h,demo,shiftDate(localDate(),index));
 }
 await h.db.exec('update discovery_runtime_settings set enabled=true,rollout_percentage=100');
 console.log(`TEST DATA ONLY: discovery preview API at ${h.base}; first discovery ${ordered[0].id}`);
 const close=()=>{void h.close().then(()=>process.exit(0));};
 process.on('SIGINT',close);process.on('SIGTERM',close);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
