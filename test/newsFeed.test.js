const test = require('node:test');
const assert = require('node:assert/strict');
const {filteredNewsPage, taxonomyActivity, allTaxonomies} = require('../utils/newsFeed');
const now = '2026-11-02T00:00:00Z';
function database(data) {
 return {from(table) {
  let filters = [], sorts = [], from = 0, to = Infinity;
  const query = {select(){return query;},eq(key,value){filters.push(row=>String(row[key])===String(value));return query;},is(key,value){filters.push(row=>row[key]===value);return query;},in(key,values){filters.push(row=>values.map(String).includes(String(row[key])));return query;},or(value){
   const match=value.match(/^publish_date\.(gte|lte)\.([^,]+)/);assert.ok(match);
   filters.push(row=>match[1]==='gte' ? (row.publish_date || row.created_at)>=match[2] : (row.publish_date || row.created_at)<=match[2]);return query;
  },order(key,{ascending=true}={}){sorts.push({key,ascending});return query;},range(a,b){from=a;to=b;return query;},then(resolve){
   const rows=(data[table] || []).filter(row=>filters.every(filter=>filter(row))).sort((a,b)=>{for(const {key,ascending} of sorts){const result=a[key]<b[key] ? -1:a[key]>b[key] ? 1:0;if(result)return ascending ? result:-result;}return 0;});
   return Promise.resolve({data:rows.slice(from,to+1),error:null}).then(resolve);
  }};return query;
 }};
}
const row=(id,extra={})=>({id,created_at:'2026-11-01T10:00:00Z',publish_date:'2026-11-01T10:00:00Z',publication_status:'published',superseded_by_outlook_id:null,news_impact_score:50,ai_outlook:{},...extra});
test('taxonomy pagination reaches newer relationships beyond the old 1000-row cap',async()=>{
 const articles=Array.from({length:1300},(_,i)=>row(i+1));
 const db=database({scriptural_outlooks:articles,outlook_categories:articles.map(article=>({outlook_id:article.id,category_id:18}))});
 const first=await filteredNewsPage(db,{columns:'*',categoryId:18,limit:12,now});
 const second=await filteredNewsPage(db,{columns:'*',categoryId:18,limit:12,offset:12,now});
 assert.equal(first[0].id,1300);assert.equal(second[0].id,1288);assert.equal(new Set([...first,...second].map(row=>row.id)).size,24);
});
test('sparse topic matches span candidate batches; combined filters intersect',async()=>{
 const articles=Array.from({length:650},(_,i)=>row(i+1));
 const db=database({scriptural_outlooks:articles,outlook_categories:[{outlook_id:4,category_id:18},{outlook_id:640,category_id:18}],outlook_topics:[{outlook_id:4,topic_id:2},{outlook_id:630,topic_id:2}]});
 assert.deepEqual((await filteredNewsPage(db,{columns:'*',topicId:2,categoryId:18,limit:12,now})).map(row=>row.id),[4]);
});
test('source dates exclude old ingested articles and future stories; ranking cannot revive archives',async()=>{
 const db=database({scriptural_outlooks:[row(1,{publish_date:'2026-08-01T00:00:00Z',news_impact_score:100}),row(2,{publish_date:'2026-11-03T00:00:00Z'}),row(3),row(4,{publication_status:'pending_review'}),row(5,{superseded_by_outlook_id:3}),row(6,{ai_outlook:{editorialReview:{status:'archived'}}})]});
 assert.deepEqual((await filteredNewsPage(db,{columns:'*',startDate:'2026-10-30T00:00:00Z',now})).map(row=>row.id),[3]);
 assert.deepEqual((await filteredNewsPage(db,{columns:'*',sort:'weighted',now})).map(row=>row.id),[3]);
});
test('topic directory is complete and activity counts only current published canonical stories',async()=>{
 const topics=Array.from({length:1300},(_,i)=>({id:i+1}));
 const db=database({topics,scriptural_outlooks:[row(1),row(2,{publication_status:'pending_review'}),row(3,{publish_date:'2026-08-01T00:00:00Z'})],outlook_topics:[1,2,3].map(outlook_id=>({outlook_id,topic_id:1300}))});
 assert.equal((await allTaxonomies(db,'topics')).length,1300);
 assert.deepEqual(await taxonomyActivity(db,'outlook_topics','topic_id',new Date(now)),{1300:{recentArticleCount:1,impactScoreWeek:50}});
});
