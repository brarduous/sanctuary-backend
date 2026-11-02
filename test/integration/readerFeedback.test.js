const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {A,B,createDatabase,installDatabase,listen}=require('../helpers/accountHarness');
const {createReaderFeedbackRouter}=require('../../routes/readerFeedback');
const db=createDatabase();installDatabase(db);let server;
const app=express();app.use(express.json());app.use('/feedback',createReaderFeedbackRouter({db,authenticateUser:require('../../middleware/auth')}));
test.before(async()=>{server=await listen(app);});test.after(()=>server.close());test.beforeEach(()=>{db.reset();db.tables.general_devotionals=[{id:1,date:'2026-01-01'},{id:2,date:'2099-01-01'}];});
async function send(type,id,{method='GET',user='alice',body}={}){const response=await fetch(`${server.base}/feedback/${type}/${id}`,{method,headers:{...(user?{Authorization:`Bearer ${user}`}:{ }),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,cache:response.headers.get('cache-control'),body:response.status===204?null:await response.json()};}
test('reader feedback is authenticated, owner-scoped, unavailable for future content and private to each reader',async()=>{
 assert.equal((await send('devotional',1,{user:null})).status,401);
 assert.equal((await send('devotional',2,{method:'PUT',body:{rating:5}})).status,404);
 assert.equal((await send('general_devotional','general-2',{method:'PUT',body:{rating:5}})).status,404);
 assert.equal((await send('devotional',1,{method:'PUT',body:{rating:5,userId:B}})).status,403);
 assert.equal((await send('devotional',1,{method:'PUT',body:{rating:5,channel:'web'}})).status,200);
 const own=await send('devotional',1);assert.equal(own.body.feedback.rating,5);assert.equal(own.cache,'private, no-store');assert.equal(own.body.feedback.user_id,undefined);
 assert.equal((await send('devotional',1,{user:'bob'})).status,404);
 assert.equal(db.tables.reader_content_feedback[0].user_id,A);
});
test('changing and removing a response cannot duplicate votes or alter another reader’s response',async()=>{
 await send('general_devotional',1,{method:'PUT',body:{rating:5}});
 await send('general_devotional',1,{method:'PUT',user:'bob',body:{rating:1}});
 const response=(await send('general_devotional',1)).body.feedback;
 assert.equal((await send('general_devotional',1,{method:'PUT',body:{...response,rating:3,practice_feasible:false,issue_tags:['repetitive']}})).status,200);
 assert.equal(db.tables.reader_content_feedback.length,2);
 assert.equal(db.tables.reader_content_feedback.find(row=>row.user_id===A).rating,3);
 assert.equal((await send('general_devotional',1,{method:'DELETE'})).status,204);
 assert.equal(db.tables.reader_content_feedback.length,1);assert.equal(db.tables.reader_content_feedback[0].user_id,B);
});
test('invalid ratings, arbitrary text and broken storage never produce a success receipt',async()=>{
 for(const body of [{rating:6},{rating:'5'},{rating:5,issue_tags:['private detail']},{rating:5,clarity:99},{rating:5,practice_feasible:'yes'}])assert.equal((await send('devotional',1,{method:'PUT',body})).status,400);
 db.fail('reader_content_feedback');assert.equal((await send('devotional',1,{method:'PUT',body:{rating:5}})).status,503);
});
