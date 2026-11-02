const {localDate}=require('./discoveries');
async function completionDate(db,userId,timeZone){
 if(timeZone)return localDate(new Date(),String(timeZone));
 const r=await db.from('user_profiles').select('notification_time_zone').eq('user_id',userId).maybeSingle();
 if(r.error&&!['42703','PGRST204'].includes(r.error.code))throw r.error;
 return localDate(new Date(),r.data?.notification_time_zone||'America/New_York');
}
async function deliveryHistory(db,dates){
 const rows=[];
 const unique=[...new Set(dates.filter(Boolean))];
 for(let offset=0;offset<unique.length;offset+=100){
  const r=await db.from('discovery_delivery_items').select('publication_date,discovery_id,source_publication_date').in('publication_date',unique.slice(offset,offset+100));
  if(r.error){if(['42P01','PGRST205'].includes(r.error.code))return [];throw r.error;}
  rows.push(...(r.data||[]));
 }
 return rows;
}
function participationDate(row,deliveries){
 const original=row.original_puzzle_date||row.puzzle_date;
 if(![1,2,3].includes(row.set_position)||!['answered','revealed'].includes(row.mode))return null;
 if(original===row.local_date)return row.local_date;
 return deliveries.some(item=>item.publication_date===row.local_date&&item.discovery_id===row.discovery_id&&item.source_publication_date===original)?row.local_date:null;
}
// Presentation aliases never replace canonical award identity or play dates.
async function presentCompletions(db,rows,today){
 const deliveries=await deliveryHistory(db,[today,...rows.map(row=>row.local_date)]);
 const active=new Map(deliveries.filter(row=>row.publication_date===today).map(row=>[row.discovery_id,row.source_publication_date]));
 return rows.map(row=>{
  const original=row.original_puzzle_date||row.puzzle_date;
  return {...row,original_puzzle_date:original,daily_play_date:participationDate(row,deliveries),...(active.has(row.discovery_id)&&original===active.get(row.discovery_id)?{puzzle_date:today}:{})};
 });
}
module.exports={presentCompletions,completionDate,deliveryHistory,participationDate};
