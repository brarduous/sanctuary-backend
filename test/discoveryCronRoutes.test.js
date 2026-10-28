const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('discovery cron and status require the configured secret before invoking any work',async()=>{
 let generated=0,statusReads=0;
 const module={exports:{}};
 const status={healthy:true,exhaustedDates:[]};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../routes/cron.js'),'utf8'),{module,console,Date,process:{env:{CRON_SECRET:'local-test-cron-secret'}},require:name=>{
  if(name==='express')return express;
  if(name==='../cron/generateGeneralDevotionals')return {};
  if(name==='../cron/generateDiscoveries')return {async generateDiscoveries(){generated++;return {status};},async getDiscoveryCurriculumStatus(){statusReads++;return status;}};
  if(name==='../config/supabase' || name==='../utils/push')return {};
  throw new Error(`Unexpected cron dependency: ${name}`);
 }});
 const app=express();app.use(express.json());app.use('/api/cron',module.exports);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  for(const [route,method] of [['/discoveries','GET'],['/discoveries','POST'],['/discoveries/status','GET']])assert.equal((await fetch(base+'/api/cron'+route,{method})).status,401);
  assert.equal(generated,0);assert.equal(statusReads,0);
  assert.equal((await fetch(base+'/api/cron/discoveries',{method:'POST',headers:{Authorization:'Bearer local-test-cron-secret'}})).status,200);
  assert.equal((await fetch(base+'/api/cron/discoveries/status',{headers:{'x-cron-secret':'local-test-cron-secret'}})).status,200);
  assert.equal(generated,1);assert.equal(statusReads,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('a provisioned disabled curriculum never loads database or model credentials',async()=>{
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cron/generateDiscoveries.js'),'utf8'),{module,console,process:{env:{},argv:[]},require:name=>{
  if(name==='dotenv')return {config(){}};
  if(name==='../utils/discoveryCurriculum')return {configFromEnv:()=>({enabled:false})};
  throw new Error(`Disabled cron must not load ${name}`);
 }});
 const result=await module.exports.generateDiscoveries();
 assert.equal(result.generated,false);assert.equal(result.reason,'disabled');
});
