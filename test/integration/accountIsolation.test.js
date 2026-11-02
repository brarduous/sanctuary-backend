const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {A,B,createDatabase,installDatabase,listen}=require('../helpers/accountHarness');
const db=createDatabase();installDatabase(db);
const app=express();app.use(express.json());
for(const name of ['devotionals','advice','prayers','user','community'])app.use(`/test/${name}`,require(`../../routes/${name}`));
app.use('/test/admin',require('../../routes/admin'));
let server;
test.before(async()=>{server=await listen(app);});test.after(()=>server.close());test.beforeEach(()=>db.reset());
async function request(path,{user='alice',method='GET',body}={}){const r=await fetch(server.base+path,{method,headers:{...(user?{Authorization:`Bearer ${user}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,text:await r.text()};}
test('two authenticated accounts cannot read each other’s devotional or guidance libraries',async()=>{
 for(const prefix of ['devotionals/devotionals','advice/advice']){
   assert.equal((await request(`/test/${prefix}/${B}`)).status,403);
   assert.equal((await request(`/test/${prefix}/${A}`)).status,200);
   assert.equal((await request(`/test/${prefix}/${A}`,{user:null})).status,401);
 }
 assert.equal((await request(`/test/devotionals/devotional/${A}/2`)).status,404);
 assert.equal((await request(`/test/devotionals/devotional/${B}/2`)).status,403);
 assert.equal((await request(`/test/advice/advice/${B}/2`)).status,403);
});
test('deletion is scoped to the authenticated owner even when the attacker knows another record id',async()=>{
 assert.equal((await request('/test/devotionals/devotional/2',{method:'DELETE'})).status,200);
 assert.equal(db.tables.daily_devotionals.length,2);
 assert.equal((await request('/test/devotionals/devotional/1',{method:'DELETE'})).status,200);
 assert.deepEqual(db.tables.daily_devotionals.map(row=>row.user_id),[B]);
});
test('feedback, follows, activity, community requests and checkout cannot impersonate another account',async()=>{
 for(const endpoint of ['feedback','log-activity','create-checkout-session'])assert.equal((await request(`/test/user/${endpoint}`,{method:'POST',body:{userId:B}})).status,403);
 for(const name of ['categories','topics'])for(const method of ['GET','POST'])assert.equal((await request(`/test/user/user-followed-${name}/${B}`,{method,...(method==='POST'?{body:{categoryIds:[],topicIds:[]}}:{})})).status,403);
 assert.equal((await request(`/test/user/streak/${B}/devotional`)).status,403);
 assert.equal((await request(`/test/user/streak/${A}/devotional`,{user:null})).status,401);
 assert.equal((await request('/test/community/community/request',{method:'POST',body:{userId:B,content:'Forged'}})).status,403);
 assert.equal(db.tables.user_activities.length,0);
 assert.equal(db.tables.content_feedback.length,0);
 assert.deepEqual(db.tables.user_followed_topics,[{user_id:B,topic_id:2}]);
});
test('congregational prayer reads require real membership and reject filter injection',async()=>{
 for(const route of ['feed','random']){
   assert.equal((await request(`/test/prayers/${route}?congregationId=2`)).status,403);
   assert.equal((await request(`/test/prayers/${route}?congregationId=1`,{user:'bob'})).status,403);
   assert.equal((await request(`/test/prayers/${route}?congregationId=1%29%2Cvisibility.eq.pastor`)).status,400);
 }
 const own=await request('/test/prayers/feed?congregationId=1');assert.equal(own.status,200);assert.ok(own.text.includes('Church one'));assert.ok(!own.text.includes('Church two'));
 const publicOnly=await request('/test/prayers/feed');assert.equal(publicOnly.status,200);assert.ok(!publicOnly.text.includes('Private'));assert.ok(!publicOnly.text.includes(B));
 db.fail('organization_memberships');assert.equal((await request('/test/prayers/feed?congregationId=1')).status,503);
});
test('quality reports are available only to verified administrators',async()=>{
 assert.equal((await request('/test/admin/quality',{user:null})).status,401);
 assert.equal((await request('/test/admin/quality')).status,403);
 db.tables.user_profiles.find(row=>row.user_id===A).role='admin';db.tables.app_quality_reports=[];
 assert.equal((await request('/test/admin/quality')).status,200);
 assert.equal((await request('/test/admin/quality',{user:'bob'})).status,403);
});
