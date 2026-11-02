const express=require('express');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function createDatabase() {
  const tables={},calls=[];let failure=null;
  const db={tables,calls,fail(table){failure=table;},reset(){
    failure=null;calls.length=0;
    Object.assign(tables,{
      daily_devotionals:[{devotional_id:1,user_id:A,status:'completed',content:'Alice reflection'},{devotional_id:2,user_id:B,status:'completed',content:'Bob reflection'}],
      advice_guidance:[{advice_id:1,user_id:A,status:'completed'},{advice_id:2,user_id:B,status:'completed'}],
      daily_prayers:[{prayer_id:1,user_id:A,status:'completed'}],
      user_followed_topics:[{user_id:B,topic_id:2}],user_followed_categories:[{user_id:B,category_id:2}],
      user_profiles:[{user_id:A,role:'user'},{user_id:B,role:'user'}],user_activities:[],content_feedback:[],reader_content_feedback:[],
      congregation_members:[{member_id:1,user_id:A,congregation_id:1}],organization_memberships:[],congregations:[],
      prayer_requests:[{id:1,congregation_id:1,visibility:'congregation',request_text:'Church one'},{id:2,congregation_id:2,visibility:'congregation',request_text:'Church two'},{id:3,visibility:'public_anonymous',request_text:'Public',user_id:B,user_profiles:{first_name:'Private'}}],
    });
  },auth:{getUser:async token=>({data:{user:token==='alice'?{id:A,email:'alice@example.test'}:token==='bob'?{id:B,email:'bob@example.test'}:null},error:null})},from(table){
    const filters=[];let action='select',body,singular=false,maximum=Infinity,conflict;
    calls.push({table,filters,get action(){return action;}});
    const q={select(){return q;},eq(k,v){filters.push(row=>String(row[k])===String(v));return q;},neq(k,v){filters.push(row=>String(row[k])!==String(v));return q;},gte(k,v){filters.push(row=>row[k]>=v);return q;},lte(k,v){filters.push(row=>row[k]<=v);return q;},lt(k,v){filters.push(row=>row[k]<v);return q;},in(k,values){filters.push(row=>values.includes(row[k]));return q;},order(){return q;},limit(n){maximum=n;return q;},single(){singular=true;return q;},maybeSingle(){singular=true;return q;},delete(){action='delete';return q;},insert(value){action='insert';body=value;return q;},update(value){action='update';body=value;return q;},upsert(value,options={}){action='upsert';body=value;conflict=options.onConflict;return q;},or(value){const match=value.match(/congregation_id.eq.(\d+)/);if(!match)throw Error('Unsupported test filter');filters.push(row=>row.visibility==='public_anonymous'||row.visibility==='congregation'&&row.congregation_id===Number(match[1]));return q;},then(resolve,reject){
      if(failure===table)return Promise.resolve({data:null,error:{code:'TEST_DB_FAILURE'}}).then(resolve,reject);
      tables[table] ||= [];let rows=tables[table].filter(row=>filters.every(predicate=>predicate(row))).slice(0,maximum);
      if(action==='delete')tables[table]=tables[table].filter(row=>!rows.includes(row));
      if(action==='update')rows.forEach(row=>Object.assign(row,body));
      if(['insert','upsert'].includes(action)){rows=(Array.isArray(body)?body:[body]).map(value=>{
        let row=action==='upsert'&&conflict?tables[table].find(item=>conflict.split(',').every(key=>String(item[key])===String(value[key]))):null;
        if(row)Object.assign(row,value);else{row={id:tables[table].length+1,...value};tables[table].push(row);}return row;
      });}
      return Promise.resolve({data:singular?rows[0]||null:rows,error:null,count:rows.length}).then(resolve,reject);
    }};return q;
  }};db.reset();return db;
}
function installDatabase(db){require.cache[require.resolve('../../config/supabase')]={exports:db};require.cache[require.resolve('../../config/openai')]={exports:{chat:{completions:{create:async()=>{throw Error('Unexpected paid model operation in account isolation test');}}}}};}
async function listen(app){const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return{base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};}
module.exports={A,B,createDatabase,installDatabase,listen};
