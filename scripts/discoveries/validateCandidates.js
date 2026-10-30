const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateContent, UUID } = require('../../utils/discoveries');
const {copyIssues}=require('../../utils/discoveryCopy');
const file = process.argv[2] || path.join(__dirname,'../../content/discoveries/biblical-candidates.json');
const entries = JSON.parse(fs.readFileSync(file,'utf8'));
const bible = JSON.parse(fs.readFileSync(path.join(__dirname,'../../../sanctuary-mobile/assets/bible/web-optimized.json'),'utf8'));
const books = [...bible.oldTestament,...bible.newTestament];
const {canonicalVerseText:decode}=require('../../utils/discoveryScripture');
const seenIds = new Set(), seenPrompts = new Set();
for (const entry of entries) {
  if (!UUID.test(entry.id) || seenIds.has(entry.id)) throw new Error('Duplicate/invalid discovery UUID.');
  seenIds.add(entry.id);
  const content = validateContent(entry.content);
  const issues=copyIssues(content);
  if(issues.length)throw new Error(`${entry.slug}: ${issues.join(', ')}`);
  if (seenPrompts.has(content.prompt.toLowerCase())) throw new Error('Duplicate question.');
  seenPrompts.add(content.prompt.toLowerCase());
  if (entry.verification?.humanReviewStatus !== 'pending') throw new Error('Candidate files cannot claim human approval. Approval lives in authenticated review records.');
  if (content.kind==='biblical_text') {
    const match=content.scriptureReference.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('A bounded verse reference is required.');
    const book=books.find(book => book.title===match[1]);
    const chapter=book?.chapters.find(chapter => chapter.number===Number(match[2]));
    if (!chapter) throw new Error('Passage is not present in bundled WEB.');
    const verses=new Map([...chapter.content.matchAll(/<sup class="v">(\d+)<\/sup><span>(.*?)<\/span>/g)].map(match => [Number(match[1]),decode(match[2].replace(/<[^>]*>/g,'')).trim()]));
    const first=Number(match[3]),last=Number(match[4] || first);
    const excerpt=Array.from({length:last-first+1},(_,index) => {
      if (!verses.has(first+index)) throw new Error('Missing verse.');
      return verses.get(first+index);
    }).join(' ');
    const source=content.sources.find(source => source.type==='scripture');
    if (source.excerpt!==excerpt || createHash('sha256').update(excerpt).digest('hex')!==entry.verification.evidenceSha256) throw new Error(`Evidence drift in ${content.scriptureReference}.`);
    if (!excerpt.toLowerCase().includes(entry.verification.answerText.toLowerCase())) throw new Error(`Answer text missing from ${content.scriptureReference}.`);
    const correct=content.choices.find(choice => choice.id===content.correctOptionId);
    if (correct.text.toLowerCase()!==entry.verification.answerText.toLowerCase()) throw new Error('Answer no longer matches checked evidence.');
  }
}
console.log(`Validated ${entries.length} unpublished candidates: unique questions, content contract, exact WEB excerpts, evidence hashes, and answer containment. These checks do not approve content; the automated evidence gate or applicable manual review must pass.`);
