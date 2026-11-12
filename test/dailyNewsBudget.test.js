const test = require('node:test');
const assert = require('node:assert/strict');
const {selectDailyBriefSources,MAX_SOURCES,MAX_EXCERPT_CHARS} = require('../utils/dailyNewsSources');
const now = Date.parse('2026-11-12T12:00:00Z');
const source = publisher => ({publisher,analysisEligible:true,publisherExcerpt:true});
const item = (id, changes={}) => ({title:[`Story ${id}`],link:[`https://example.com/${id}?utm_source=feed`],description:[`<p>${'Reported facts. '.repeat(100)}</p>`],pubDate:[new Date(now-3600000).toISOString()],...changes});
test('daily source input has a hard size bound and publisher diversity', () => {
 const selected=selectDailyBriefSources(['A','B','C'].map(publisher=>({source:source(publisher),items:Array.from({length:30},(_,i)=>item(`${publisher}-${i}`))})),now);
 assert.equal(selected.length,MAX_SOURCES);
 assert.deepEqual(selected.slice(0,3).map(s=>s.publisher),['A','B','C']);
 assert.ok(selected.every(s=>s.excerpt.length<=MAX_EXCERPT_CHARS && !s.excerpt.includes('<p>') && !s.url.includes('utm_')));
});
test('daily source input rejects stale, future, duplicate, short and unauthorized excerpts',()=>{
 const selected=selectDailyBriefSources([
  {source:source('A'),items:[item('good'),item('good'),item('stale',{pubDate:[new Date(now-86400001).toISOString()]}),item('future',{pubDate:[new Date(now+1).toISOString()]}),item('short',{description:['Headline only']}),item('bad',{link:['javascript:alert(1)']})]},
  {source:{...source('B'),analysisEligible:false},items:[item('unauthorized')]}
 ],now);
 assert.equal(selected.length,1); assert.equal(selected[0].title,'Story good');
});

const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function pipeline({duplicate=false,accepted=true}={}) {
 const calls=[],writes=[];
 const db={from(table){return {
   insert(payload){writes.push({table,payload}); if(table==='news_daily_generation_runs')return {error:duplicate ? {code:'23505'}:null};return {select:async()=>({data:[payload]})};},
   update(payload){writes.push({table,payload});return {eq:async()=>({error:null})};}
 };}};
 class OpenAI { constructor(options){assert.equal(options.maxRetries,0);this.chat={completions:{create:async request=>{calls.push(request);return {choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{total_tokens:100}};}}};} }
 const module={exports:{}};
 const replacements={
  '@supabase/supabase-js':{createClient:()=>db},openai:OpenAI,dotenv:{config(){}},
  '../prompts':{getDailyNewsSynopsisPrompt:async()=> 'Daily news'},
  '../utils/newsBrief':{parseDailyEditionResponse:()=>({synopsis:'Summary',details:'Details',stories:[],thought_to_remember:'Thought',prayer:'Prayer',tokens:100})},
  '../utils/dailyNewsSources':{fetchDailyBriefSources:async()=>[{title:'Reported story'}]},
  '../utils/newsReaderReview':{reviewNewsReaderCopy:async(client,options)=>{calls.push(options);return {accepted,issues:accepted?[]:['Unsupported claim'],tokens:20};}},
  '../utils/helpers':{logEvent:async()=>{}}
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../cron/dailyNewsSynopsis.js'),'utf8'),{require:name=>{if(!(name in replacements))throw new Error(name);return replacements[name];},module,process:{env:{}},console:{log(){},error(){}},Date});
 return {run:module.exports.generateDailyNewsSynopsisFromLast24h,calls,writes};
}
test('duplicate daily invocation makes no model calls',async()=>{
 const p=pipeline({duplicate:true});await p.run();assert.equal(p.calls.length,0);
});
test('daily generation makes one capped draft and one capped review',async()=>{
 const p=pipeline();await p.run();assert.equal(p.calls.length,2);assert.equal(p.calls[0].max_completion_tokens,6000);assert.equal(p.calls[1].maxTokens,2000);
 assert.ok(p.writes.some(w=>w.payload.status==='completed' && w.payload.tokens===120));
});
test('failed review preserves previous edition and does not trigger a paid rewrite',async()=>{
 const p=pipeline({accepted:false});await assert.rejects(p.run(),/Unsupported claim/);assert.equal(p.calls.length,2);
 assert.ok(!p.writes.some(w=>w.table==='daily_news_synopses'));assert.ok(p.writes.some(w=>w.payload.status==='failed'));
});
test('email renders the shared edition and safely links to original reporting without article outlooks',()=>{
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/newsletter.js'),'utf8'),{module,process:{env:{}},Buffer,require:name=> name==='../config/supabase'?{}:name==='resend'?{Resend:class {}}:require(name)});
 const html=module.exports.briefingHtml({date:'2026-11-12',synopsis:{synopsis:'Daily summary',details:'Richer <context>',sources:[{title:'Original',publisher:'Publisher',url:'https://example.com/story'},{title:'Unsafe',url:'javascript:alert(1)'}]},unsubscribeToken:'test'});
 assert.match(html,/Richer &lt;context&gt;/);assert.match(html,/https:\/\/example.com\/story/);assert.doesNotMatch(html,/javascript:|\/article\//);
});
test('edition citations use only supplied report IDs and never invent internal article links',()=>{
 const {parseDailyEditionResponse}=require('../utils/newsBrief');
 const story={headline:'Neighbors share food',summary:'Neighbors organized a food collection for local families.',christianAssessment:{verdict:'aligned',focusType:'reported_conduct',focus:'Sharing food with neighbors',reason:'Practical care for neighbors reflects the call to show mercy.',scriptureReference:'Micah 6:8'},sourceReportIds:[1]};
 const content={synopsis:'Daily',details:'Reporting details',thought_to_remember:'Remember mercy',prayer:'Help us care',stories:[story]};
 const sources=[{id:1,title:'Original',url:'https://example.com/story',publisher:'Publisher'}];
 const parsed=parseDailyEditionResponse(JSON.stringify(content),100,sources);
 assert.equal(parsed.stories[0].sourceReports[0].url,sources[0].url);assert.equal(parsed.stories[0].sourceArticles,undefined);
 assert.throws(()=>parseDailyEditionResponse(JSON.stringify({...content,stories:[{...story,sourceReportIds:[999]}]}),100,sources),/supplied source/);
});
test('queued article and brief rewrites are protected without paid model calls',async()=>{
 const {runReplacements}=require('../services/contentQualityReplacement');
 let paid=0;const jobs=[{id:1,kind:'news'},{id:2,kind:'daily_brief'}],actions=[];
 const db={rpc:async(name,args)=>name==='content_quality_claim'?{data:jobs.shift()||null}:{data:actions.push(args.p_action)}};
 const result=await runReplacements({db,client:{chat:{completions:{create:async()=>{paid++;throw Error('Unexpected paid call');}}}},scanPending:false,limit:3});
 assert.equal(paid,0);assert.equal(result.protected,2);assert.deepEqual(actions,['protected','protected']);
});
