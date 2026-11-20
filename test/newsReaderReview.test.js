const test=require('node:test'),assert=require('node:assert/strict');
const {reviewNewsReaderCopy}=require('../utils/newsReaderReview');
const copy={tldr:{christianAssessment:{scriptureReference:'Micah 6:8'}}};
const client=result=>({chat:{completions:{async create(request){assert.match(request.messages[0].content,/ONLY concrete blocking defects/);assert.match(request.messages[1].content,/Micah/);return {id:'actual-mock-response-id',choices:[{message:{content:JSON.stringify(result)}}]};}}}});
test('only a complete successful independent review passes, and model fields cannot override acceptance or provenance',async()=>{
 const good={supported:true,biblicalContextSound:true,audienceFit:true,tldrIncludesChristianJudgment:true,issues:[]};
 assert.equal((await reviewNewsReaderCopy(client(good),{source:'Reporting',copy})).accepted,true);
 for(const result of [{...good,supported:false,accepted:true,responseId:'invented'},{...good,issues:['Unsupported attribution']},{...good,issues:undefined}]){
  const checked=await reviewNewsReaderCopy(client(result),{source:'Reporting',copy});assert.equal(checked.accepted,false);assert.equal(checked.responseId,'actual-mock-response-id');
 }
});
