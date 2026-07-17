const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.STAGING_ISOLATION_TEST_PASSWORD;
if (!url || !serviceKey || !anonKey || !password) throw new Error('Set staging Supabase credentials and the test password.');
if (process.env.NODE_ENV === 'production') throw new Error('The content journey must never run in production.');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
async function signIn(email) { const client=createClient(url,anonKey,{auth:{persistSession:false}}); const {data,error}=await client.auth.signInWithPassword({email,password}); if(error)throw error; return {token:data.session.access_token,user:data.user}; }
async function request(base,path,token,method='GET',body,headers={}) { const response=await fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}); return {response,payload:await response.json()}; }

(async()=>{
  const [author,other]=await Promise.all([signIn('message-harbor@example.com'),signIn('message-hillside@example.com')]);
  const app=require('../index');
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  let sermonId; let studyId;
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const sermon=await request(base,'/sermon-drafts',author.token,'POST',{title:`Production journey sermon ${Date.now()}`,sermon_body:'Initial pastoral draft.',scripture:'Philippians 4:4-9',content_format:'sermon',distribution_channel:'pulpit',target_duration_min:20});
    if(sermon.response.status!==201||sermon.payload.user_id!==author.user.id)throw new Error(`Sermon draft failed (${sermon.response.status}).`); sermonId=sermon.payload.sermon_id;
    const saved=await request(base,`/sermons/${sermonId}`,author.token,'POST',{title:'Rejoice with gentleness',sermon_body:'Edited and reviewed pastoral manuscript.',status:'completed',user_id:other.user.id});
    if(saved.response.status!==201||saved.payload.status!=='completed'||saved.payload.user_id!==author.user.id)throw new Error('Sermon save or immutable ownership failed.');
    const deniedSermon=await request(base,`/sermon/${sermonId}`,other.token);
    if(deniedSermon.response.status!==404)throw new Error(`Cross-user sermon read returned ${deniedSermon.response.status}.`);

    const study=await request(base,'/bible-study-drafts',author.token,'POST',{title:`Production journey study ${Date.now()}`,subtitle:'A reviewed staging curriculum',study_method:'Expositional Method Blueprint',lesson_title:'Practicing gentleness',scripture:'Philippians 4:4-9'});
    if(study.response.status!==201||study.payload.user_id!==author.user.id||study.payload.lessons?.length!==1)throw new Error(`Study draft failed (${study.response.status}).`); studyId=study.payload.study_id;
    const lessonId=study.payload.lessons[0].lesson_id;
    const editedLesson=await request(base,`/bible-study-lessons/${lessonId}`,author.token,'POST',{study_id:studyId,title:'Practicing gentleness together',commentary:'Reviewed facilitator notes.',user_id:other.user.id});
    if(editedLesson.response.status!==200||editedLesson.payload.user_id!==author.user.id)throw new Error('Study lesson edit or immutable ownership failed.');
    const published=await request(base,`/bible-study/${studyId}`,author.token,'PUT',{is_published:true,congregation_id:900001},{'x-suppress-notifications':'true'});
    if(published.response.status!==200||published.payload.is_published!==true||published.payload.congregation_id!==900001)throw new Error(`Study publishing failed (${published.response.status}).`);
    const deniedStudy=await request(base,`/bible-study/${studyId}`,other.token);
    const deniedLesson=await request(base,`/bible-study-lessons/detail/${lessonId}`,other.token);
    if(deniedStudy.response.status!==404||deniedLesson.response.status!==404)throw new Error('Cross-user study or lesson access was not denied.');
    console.log(JSON.stringify({sermon:{draft:201,edit:201,completed:true,crossUser:404,ownershipImmutable:true},study:{draft:201,lessonEdit:200,published:true,crossUser:404,crossUserLesson:404,ownershipImmutable:true}}));
  } finally {
    if(sermonId)await admin.from('sermons').delete().eq('sermon_id',sermonId);
    if(studyId)await admin.from('bible_studies').delete().eq('study_id',studyId);
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
