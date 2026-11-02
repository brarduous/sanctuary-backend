const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeNewsReaderCopy,validateNewsTldr,formatNewsTldr}=require('../utils/newsReaderCopy');
const tldr={summary:'Neighbors organized a food collection for local families.',christianAssessment:{verdict:'aligned',focusType:'reported_conduct',focus:'Sharing food with neighbors',reason:'Practical care for neighbors reflects the call to show mercy.',scriptureReference:'Micah 6:8'}};
test('TLDR always contains a plain Christian judgment and a real Scripture reference',()=>{
 const value=normalizeNewsReaderCopy({tldr,newsSummary:'Residents collected food for local families. Volunteers organized distribution through a community center, according to the supplied reporting.'});
 assert.match(value.synopsis,/Consistent with Christian teaching/);assert.match(value.synopsis,/Micah 6:8/);assert.ok(value.tldr.christianAssessment.scriptureExcerpt.includes('mercy'));
 assert.notEqual(value.synopsis,value.newsSummary);assert.equal(value.readerCopyVersion,'news-reader-copy-v3');
});
test('missing judgments, fabricated verses, unfocused citations and missing detail fail before publication',()=>{
 for(const value of [undefined,{...tldr,christianAssessment:undefined},{...tldr,christianAssessment:{...tldr.christianAssessment,verdict:'definitely-Christian'}},{...tldr,christianAssessment:{...tldr.christianAssessment,scriptureReference:'Micah 6:999'}},{...tldr,christianAssessment:{...tldr.christianAssessment,scriptureReference:'Genesis 1:1-20'}}])assert.throws(()=>validateNewsTldr(value));
 assert.throws(()=>normalizeNewsReaderCopy({tldr}));
});
test('mixed and uncertain assessments remain explicit instead of forcing a binary verdict',()=>{
 for(const verdict of ['mixed','unclear'])assert.match(formatNewsTldr(validateNewsTldr({...tldr,christianAssessment:{...tldr.christianAssessment,verdict}})),verdict==='mixed' ? /Mixed/:/Not enough information/);
});

test('reader responses cannot substitute for the subject conduct, including aligned responses',()=>{
 for(const verdict of ['aligned','unclear','concerns','mixed'])assert.throws(()=>validateNewsTldr({...tldr,christianAssessment:{...tldr.christianAssessment,focusType:'recommended_response',verdict}}));
 assert.throws(()=>validateNewsTldr({...tldr,christianAssessment:{...tldr.christianAssessment,focusType:undefined}}));
});
test('standalone synopsis names the conduct being judged',()=>{
 const violence=validateNewsTldr({...tldr,christianAssessment:{...tldr.christianAssessment,verdict:'concerns',focus:'The reported Dallas shootings',reason:'The reported shootings violate human dignity and the call to love our neighbors.'}});
 assert.match(formatNewsTldr(violence),/assessment of The reported Dallas shootings — Conflicts/);
 const insult=validateNewsTldr({...tldr,christianAssessment:{...tldr.christianAssessment,verdict:'concerns',focus:"Trump's reported personal insult",reason:'Demeaning a person conflicts with speech that respects the dignity of our neighbors.',scriptureReference:'Ephesians 4:29'}});
 assert.match(formatNewsTldr(insult),/Trump's reported personal insult — Conflicts/);
});
