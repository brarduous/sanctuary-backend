const {loadCorpus,normalize,sha}=require('./discoveryScripture');
const MAX_RESULTS=5,MAX_EXCERPT=1200;
const fold=value=>normalize(String(value)).normalize('NFD').replace(/\p{M}/gu,'');
const limit=value=>Number.isInteger(value) && value>0 ? Math.min(value,MAX_RESULTS):3;
const short=value=>String(value || '').slice(0,MAX_EXCERPT);
const bookNames=new Map(loadCorpus().books.map(book=>[fold(book.code),fold(book.name)]));
const chapter=value=>{
 const parts=fold(String(value).replace(/\./g,' ')).match(/^(.+?) (\d+)/);
 return parts ? `${bookNames.get(parts[1]) || parts[1]} ${parts[2]}`:null;
};
function createReferenceTools(index,corpus=loadCorpus()) {
 if(index?.version!=='trivia-reference-pilot-v1' || !Array.isArray(index.sources) || !Array.isArray(index.entries))throw new Error('A versioned reference index is required.');
 const sources=new Map(index.sources.map(source=>[source.id,source]));
 for(const entry of index.entries)if(!sources.has(entry.sourceId) || sha(entry.text)!==entry.excerptSha256)throw new Error('Reference source lineage or excerpt hash is invalid.');
 const packet=(entry)=>{
  const source=sources.get(entry.sourceId);
  return {citationId:entry.id,type:entry.type,locator:entry.locator,excerpt:short(entry.text),excerptSha256:sha(short(entry.text)),entrySha256:entry.excerptSha256,
   source:{id:source.id,title:source.title,url:source.url,version:source.version,sha256:source.sha256,license:source.license,attribution:source.attribution,retrievedAt:source.retrievedAt,extractionVersion:source.extractionVersion},
   uncertainty:entry.uncertainty,language:entry.language,lemma:entry.lemma,gloss:entry.gloss,strongId:entry.strongId,extendedId:entry.extendedId,periods:entry.periods,attestations:entry.attestations,candidates:entry.candidates,
   ...(entry.start!==undefined ? {entryId:entry.entryId,characterRange:[entry.start,entry.start+Math.min(entry.text.length,MAX_EXCERPT)]}:{})};
 };
 const result=(rows,max)=>({sufficientEvidence:rows.length>0,totalMatches:rows.length,truncated:rows.length>limit(max),results:rows.slice(0,limit(max)).map(packet),purpose:'Research only. External facts cannot bypass the saved-passage publication gate.'});
 const find=(args)=>{
  const q=fold(args.query || '');
  if(q.length>100 || (!q && !args.passage))throw new Error('Use a bounded query or passage.');
  const pc=args.passage ? chapter(args.passage):null;
  if(args.passage && !pc)throw new Error('A valid passage is required.');
  const types=args.types || ['commentary','lexicon','geography'];
  if(!Array.isArray(types) || types.some(t=>!['commentary','lexicon','geography'].includes(t)))throw new Error('Unsupported research source type.');
  return index.entries.filter(e=>types.includes(e.type) && (!pc || (e.passages || []).some(p=>chapter(p)===pc)) && (!q || fold([e.locator,...(e.aliases || []),e.gloss || '',e.text].join(' ')).includes(q)));
 };
 return {
  searchReferences(args={}){
   const rows=find(args),seen=new Set(),first=[],rest=[];
   for(const row of rows){if(seen.has(row.sourceId))rest.push(row);else{seen.add(row.sourceId);first.push(row);}}
   return result([...first,...rest],args.limit);
  },
  lookupLexeme({query,language='grc',limit:max}={}){
   const q=fold(query || '');if(!q || q.length>100)throw new Error('Use a lemma, transliteration or dictionary ID.');
   const rows=index.entries.filter(e=>e.type==='lexicon' && e.language===language && [e.lemma,e.transliteration,e.strongId,e.extendedId].some(value=>fold(value)===q));
   return {...result(rows,max),senseAssignment:'Not established for a particular verse. Inspect contextual examples and text.'};
  },
  lookupPlace({nameOrId,period,limit:max}={}){
   const q=fold(nameOrId || '');if(!q || q.length>100 || (period && (typeof period!=='string' || period.length>80)))throw new Error('Use a bounded place ID/name and period.');
   const rows=index.entries.filter(e=>e.type==='geography' && [e.id,e.placeId,...(e.aliases || [])].some(v=>fold(v)===q) && (!period || (e.periods || []).includes(period)));
   return {...result(rows,max),identificationCertainty:'Inspect source-specific alternatives and attestations. No archaeological certainty inferred.'};
  },
  getSourceContext({citationId,before=0,after=0}={}){
   if(!Number.isInteger(before) || !Number.isInteger(after) || before<0 || after<0 || before>2 || after>2)throw new Error('Context expansion is bounded to two neighboring chunks.');
   const found=index.entries.find(e=>e.id===citationId);
   if(!found)return result([],1);
   const rows=found.entryId ? index.entries.filter(e=>e.entryId===found.entryId && e.start>=found.start-before*1200 && e.start<=found.start+after*1200):[found];
   return result(rows,5);
  },
  findOccurrences({phrase,books,limit:max}={}){
   const q=fold(phrase || '');if(q.length<2 || q.length>80 || (books && (!Array.isArray(books) || books.length>10)))throw new Error('Use a two-to-eighty-character exact phrase and at most ten books.');
   const matches=[];
   for(const book of corpus.books){
    if(books && !books.some(name=>fold(name)===fold(book.name)))continue;
    for(const c of book.chapters)for(const v of c.verses)if((' '+fold(v.text)+' ').includes(' '+q+' '))matches.push({citationId:`web:${book.code}:${c.number}:${v.number}`,locator:`${book.name} ${c.number}:${v.number}`,excerpt:v.text,excerptSha256:sha(v.text),corpusVersion:corpus.version,corpusSha256:corpus.sha256,license:corpus.rights});
   }
   return {sufficientEvidence:matches.length>0,totalMatches:matches.length,truncated:matches.length>limit(max),results:matches.slice(0,limit(max)),searchKind:'Exact normalized WEB phrase; not a Greek/Hebrew lemma concordance.'};
  },
  compareEvidence({claim,citationIds}={}){
   if(typeof claim!=='string' || claim.length<5 || claim.length>250 || !Array.isArray(citationIds) || citationIds.length>5)throw new Error('Compare a short claim against at most five citations.');
   const rows=citationIds.map(id=>index.entries.find(e=>e.id===id)).filter(Boolean);
   return {...result(rows,5),claim,claimVerified:false,sourceIndependence:'Not established. Separate domains may share upstream sources.',missingCitationIds:citationIds.filter(id=>!rows.some(row=>row.id===id))};
  },
 };
}
function buildResearchPacket(evidence,{index=require('../content/discoveries/reference-pilot-index.json')}={}) {
 const tools=createReferenceTools(index);
 const packet=tools.searchReferences({passage:evidence.source.locator,limit:3});
 return {version:index.version,restriction:'Research only. Only the saved WEB passage may support published premises, answers and claims.',...packet};
}
module.exports={createReferenceTools,buildResearchPacket};
