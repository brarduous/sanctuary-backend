const unwrap=r=>{if(r.error)throw r.error;return r.data;};
// Presentation dates may change; canonical completion rows and award identity do not.
async function presentCompletions(db,rows,today){
 const {data,error}=await db.from('discovery_delivery_items').select('discovery_id,source_publication_date').eq('publication_date',today);
 if(error){if(['42P01','PGRST205'].includes(error.code))return rows;throw error;}
 const active=new Map((data||[]).map(row=>[row.discovery_id,row.source_publication_date]));
 return rows.map(row=>active.has(row.discovery_id)&&row.puzzle_date===active.get(row.discovery_id)?{...row,original_puzzle_date:row.puzzle_date,puzzle_date:today}:row);
}
module.exports={presentCompletions};
