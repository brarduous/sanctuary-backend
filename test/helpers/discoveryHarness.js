const {PGlite,types}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const express=require('express');
const {validateContent,localDate}=require('../../utils/discoveries');
const ADMIN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const identifier=value=>{if (!/^[a-z_][a-z_0-9]*$/.test(value))throw new Error('Invalid test SQL identifier');return `"${value}"`;};
// Test-only PostgREST-shaped transport backed by the actual PostgreSQL migration.
function transport(db) {
 return {
  from(table) {
   let fields='*',where=[],args=[],sort=[],limit='',action='select',body=null,conflict=null,ignoreDuplicates=false,single=false,count=false;
   const param=value=>{args.push(value);return `$${args.length}`;};
   const q={
    select(value='*',options={}){fields=value==='*' ? '*' : value.split(',').map(part=>identifier(part.trim())).join(',');count=options.count==='exact';return q;},
    eq(column,value){where.push(`${identifier(column)} = ${param(value)}`);return q;},
    gte(column,value){where.push(`${identifier(column)} >= ${param(value)}`);return q;},
    lte(column,value){where.push(`${identifier(column)} <= ${param(value)}`);return q;},
    in(column,values){where.push(values.length ? `${identifier(column)} in (${values.map(param).join(',')})` : 'false');return q;},
    order(column,options={}){sort.push(`${identifier(column)} ${options.ascending===false ? 'desc':'asc'}`);return q;},
    limit(n){limit=` limit ${Number(n)}`;return q;},
    range(start,end){limit=` limit ${Number(end)-Number(start)+1} offset ${Number(start)}`;return q;},
    maybeSingle(){single=true;return q;},single(){single=true;return q;},
    insert(value){action='insert';body=value;return q;},
    update(value){action='update';body=value;return q;},
    upsert(value,options){action='insert';body=value;conflict=options.onConflict;ignoreDuplicates=options.ignoreDuplicates===true;return q;},
    async then(resolve,reject){
     try {
      const filter=where.length ? ` where ${where.join(' and ')}`:'';
      let sql;
      if(action==='select')sql=`select ${fields}${count ? ',count(*) over() as __count':''} from public.${identifier(table)}${filter}${sort.length ? ` order by ${sort.join(',')}`:''}${limit}`;
      else if(action==='update')sql=`update public.${identifier(table)} set ${Object.entries(body).map(([k,v])=>`${identifier(k)}=${param(v)}`).join(',')}${filter} returning ${fields}`;
      else sql=`insert into public.${identifier(table)}(${Object.keys(body).map(identifier).join(',')}) values(${Object.values(body).map(param).join(',')})${conflict ? ` on conflict(${conflict.split(',').map(identifier).join(',')}) ${ignoreDuplicates ? 'do nothing':`do update set ${Object.keys(body).map(key=>`${identifier(key)}=excluded.${identifier(key)}`).join(',')}`}`:''} returning ${fields}`;
      const result=await db.query(sql,args);
      const rows=result.rows.map(({__count,...row})=>row);
      resolve({data:single ? rows[0] || null:rows,error:null,count:result.rows[0]?.__count || 0});
     }catch(error){resolve({data:null,error});}
    }
   };return q;
  },
  async rpc(name,values) {
   try {const args=Object.values(values);const result=await db.query(`select public.${identifier(name)}(${Object.keys(values).map((key,index)=>`${identifier(key)} => $${index+1}`).join(',')}) as result`,args);return {data:result.rows[0].result,error:null};}
   catch(error){return {data:null,error};}
  }
 };
}
async function createHarness({listen=false,port=0,curriculum=false}={}) {
 const db=await PGlite.create({parsers:{[types.DATE]:value=>value}});
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); create table public.user_profiles(user_id uuid primary key, role text); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261028120000_daily_discoveries.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261028200000_discovery_game_results.sql'),'utf8'));
 if(curriculum) {
  await db.exec('create table general_devotionals(date date primary key,scripture_reference text)');
  await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261028153000_discovery_curriculum.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261028220000_discovery_question_craft.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261028234500_discovery_source_options.sql'),'utf8'));
 }
 for(const [id,role] of [[ADMIN,'admin'],[MEMBER,'member'],[OTHER,'member']]) {
  await db.query('insert into auth.users values($1)',[id]);await db.query('insert into user_profiles values($1,$2)',[id,role]);
 }
 const client=transport(db);
 const auth=(req,res,next)=>{const token=req.get('Authorization')?.replace('Bearer ','');if(![ADMIN,MEMBER,OTHER].includes(token))return res.sendStatus(401);req.user={id:token};next();};
 const optional=(req,_res,next)=>{const token=req.get('Authorization')?.replace('Bearer ','');if([ADMIN,MEMBER,OTHER].includes(token))req.user={id:token};next();};
 const admin=(req,res,next)=>req.user.id===ADMIN ? next():res.sendStatus(403);
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../routes/discoveries.js'),'utf8'),{module,console,URL,Date,require:name=>{
  const overrides={'../config/supabase':client,'../middleware/auth':auth,'../middleware/optionalAuth':optional,'../middleware/adminAuth':admin,'../utils/discoveries':require('../../utils/discoveries')};
  return name in overrides ? overrides[name]:require(name);
 }});
 const app=express();app.use(require('cors')({origin:['http://localhost:3010','http://127.0.0.1:3010','http://localhost:8083']}));app.use(express.json());app.use('/api/v1/discoveries',module.exports.router);app.use('/admin/discoveries',module.exports.adminRouter);
 app.use((error,_req,res,_next)=>res.status(error.status || 500).json({error:error.message,code:error.code}));
 let server=null,base=null;
 if(listen){server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;}
 return {db,app,client,base,async close(){if(server)await new Promise(resolve=>server.close(resolve));await db.close();}};
}
async function seedReviewed(harness,entry,date=localDate(),rev=1) {
 // Explicit test fixtures, never production approvals or import scripts.
 const content=validateContent(entry.content);
 const first=await harness.client.rpc('discovery_import',{p_id:entry.id,p_slug:entry.slug,p_content:content,p_actor:ADMIN});if(first.error)throw first.error;
 const result=await harness.client.rpc('discovery_approve',{p_id:entry.id,p_revision:rev,p_actor:ADMIN,p_note:'Synthetic test approval for isolated verification only; never a production editorial decision.',p_attestations:{sourcesReadInContext:true,everyClaimSupported:true,oneUnambiguousAnswer:true,scopeAndUncertaintyAccurate:true,rightsChecked:true}});if(result.error)throw result.error;
 const schedule=await harness.client.rpc('discovery_schedule_item',{p_id:entry.id,p_revision:rev,p_date:date,p_actor:ADMIN});if(schedule.error)throw schedule.error;
 return content;
}
module.exports={createHarness,seedReviewed,ADMIN,MEMBER,OTHER};
