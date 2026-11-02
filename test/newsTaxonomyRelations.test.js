const test=require('node:test'),assert=require('node:assert/strict');
const {copyOutlookTaxonomies}=require('../utils/newsTaxonomyRelations');
function database({readError=false,writeError=false}={}){
 const data={outlook_categories:[{outlook_id:1,category_id:12},{outlook_id:1,category_id:12},{outlook_id:1,category_id:18},{outlook_id:2,category_id:18}],outlook_topics:[{outlook_id:1,topic_id:3}]};let inserts=0;
 return {data,get inserts(){return inserts;},from(table){let id;return {select(){return this;},eq(_,value){id=value;return this;},then(resolve){return Promise.resolve({data:data[table].filter(row=>row.outlook_id===id),error:readError ? new Error('Read failed'):null}).then(resolve);},insert(rows){inserts++;if(writeError)return Promise.resolve({error:new Error('Write failed')});data[table].push(...rows);return Promise.resolve({error:null});},upsert(){throw new Error('No production conflict constraint');}};}};
}
test('cluster consolidation copies missing links without a nonexistent unique constraint',async()=>{
 const db=database();await copyOutlookTaxonomies(db,1,2);
 assert.deepEqual(db.data.outlook_categories.filter(row=>row.outlook_id===2).map(row=>row.category_id).sort(),[12,18]);
 assert.deepEqual(db.data.outlook_topics.filter(row=>row.outlook_id===2),[{outlook_id:2,topic_id:3}]);
 const inserts=db.inserts;await copyOutlookTaxonomies(db,1,2);assert.equal(db.inserts,inserts);
});
test('failed reads cannot create links and failed writes are surfaced',async()=>{
 const unreadable=database({readError:true});await assert.rejects(copyOutlookTaxonomies(unreadable,1,2),/Read failed/);assert.equal(unreadable.inserts,0);
 await assert.rejects(copyOutlookTaxonomies(database({writeError:true}),1,2),/Write failed/);
});
