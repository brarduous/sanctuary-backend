const {createHash}=require('node:crypto');
const {normalizeFeaturedReference}=require('./featuredScripture');
let cached;
// Canonical plain text: remove markup, decode entities, and normalize whitespace only.
const canonicalVerseText=value=>value.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
const sha=value=>createHash('sha256').update(typeof value==='string' ? value : JSON.stringify(value)).digest('hex');
const normalize=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
function loadCorpus() {
  if(cached)return cached;
  const corpus=require('../content/discoveries/web-corpus.json');
  if(corpus.translation!=='WEB' || sha(corpus.books)!==corpus.sha256)throw new Error('Discovery Scripture corpus integrity check failed.');
  cached=corpus;return corpus;
}
function scriptureEvidence(reference,corpus=loadCorpus()) {
  const normalized=normalizeFeaturedReference(reference);
  const match=normalized.match(/^(.+?) ([1-9]\d*)(?::([1-9]\d*)(?:[-–]([1-9]\d*))?)?$/);
  if(!match)throw new Error('A single bounded biblical passage is required.');
  const book=corpus.books.find(book=>book.name.toLowerCase()===match[1].toLowerCase());
  const chapter=book?.chapters.find(chapter=>chapter.number===Number(match[2]));
  if(!chapter)throw new Error('Passage is absent from the trusted corpus.');
  const start=Number(match[3] || chapter.verses[0].number);
  let end=Number(match[4] || match[3] || Math.min(start+11,chapter.verses.at(-1).number));
  if(!match[3]) {
    const gap=Array.from({length:end-start+1},(_,i)=>start+i).find(n=>!chapter.verses.some(verse=>verse.number===n));
    if(gap)end=gap-1;
  }
  if(end<start || end-start>19)throw new Error('Discovery evidence must contain at most twenty verses.');
  const verses=[],numberedVerses=[];
  for(let number=start;number<=end;number++) {
    const verse=chapter.verses.find(verse=>verse.number===number);
    if(!verse)throw new Error('Evidence range contains a missing verse.');
    verses.push(verse.text);numberedVerses.push({verseNumber:number,text:verse.text});
  }
  const locator=`${book.name} ${chapter.number}:${start}${start===end ? '' : `-${end}`}`;
  const excerpt=verses.join(' ');
  if(excerpt.length>8000)throw new Error('Source passage exceeds the saved-evidence limit.');
  const source={id:'passage',type:'scripture',title:'World English Bible (classic)',publisher:corpus.publisher,url:`https://ebible.org/eng-web/${book.code}${String(chapter.number).padStart(book.code==='PSA' ? 3 : 2,'0')}.htm`,locator,excerpt,rights:corpus.rights};
  return {source,verses:numberedVerses,sourceSha256:sha(excerpt),corpusVersion:corpus.version,corpusSha256:corpus.sha256,context:chapter.verses.map(verse=>`${verse.number} ${verse.text}`).join(' ')};
}
function contextualEvidence(reference,corpus=loadCorpus()) {
  const match=normalizeFeaturedReference(reference).match(/^(.+?) ([1-9]\d*):([1-9]\d*)/);
  if(!match)return scriptureEvidence(reference,corpus);
  const book=corpus.books.find(book=>book.name.toLowerCase()===match[1].toLowerCase());
  const chapter=book?.chapters.find(chapter=>chapter.number===Number(match[2]));
  const center=Number(match[3]);
  if(!chapter?.verses.some(verse=>verse.number===center))throw new Error('Featured verse is not in the trusted text.');
  let start=center,end=center;
  while(start>Math.max(1,center-5) && chapter.verses.some(verse=>verse.number===start-1))start--;
  while(end<start+11 && chapter.verses.some(verse=>verse.number===end+1))end++;
  return scriptureEvidence(`${book.name} ${chapter.number}:${start}-${end}`,corpus);
}
module.exports={canonicalVerseText,sha,normalize,loadCorpus,scriptureEvidence,contextualEvidence};
