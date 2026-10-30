const test=require('node:test');
const assert=require('node:assert/strict');
const {createReferenceTools}=require('../utils/triviaReferences');
const index=require('../content/discoveries/reference-pilot-index.json');
const tools=createReferenceTools(index);
test('research preserves source hashes, attribution, exact Greek accents and no-sense-assignment boundaries',()=>{
 const row=tools.lookupLexeme({query:'G4611'});assert.equal(row.sufficientEvidence,true);
 assert.equal(row.results[0].source.license,'CC BY 4.0');assert.match(row.results[0].source.attribution,/STEPBible/);
 const same=tools.lookupLexeme({query:row.results[0].lemma});assert.equal(same.results[0].citationId,row.results[0].citationId);
 assert.match(row.senseAssignment,/Not established/);
 assert.equal(tools.lookupLexeme({query:'made-up-lemma'}).sufficientEvidence,false);
 assert.equal(tools.lookupLexeme({query:'G4611',language:'hbo'}).sufficientEvidence,false);
 const changed=structuredClone(index);changed.entries[0].text+=' altered';assert.throws(()=>createReferenceTools(changed),/hash/);
});
test('geography returns attributed competing sources, periods and uncertainty without borrowed images or geometry',()=>{
 const row=tools.lookupPlace({nameOrId:'Philippi',limit:5});assert.ok(row.results.length>=2);
 assert.ok(row.results.some(r=>r.source.id.startsWith('pleiades')));assert.ok(row.results.every(r=>r.uncertainty));
 assert.equal(tools.lookupPlace({nameOrId:'Atlantis'}).sufficientEvidence,false);
 assert.equal(tools.lookupPlace({nameOrId:'Philippi',period:'made-up-period'}).sufficientEvidence,false);
 const serialized=JSON.stringify(row);assert.ok(!serialized.includes('thumbnail'));assert.ok(!serialized.includes('lonlat'));
 const compared=tools.compareEvidence({claim:'Philippi was an ancient city',citationIds:row.results.map(r=>r.citationId)});assert.equal(compared.claimVerified,false);assert.match(compared.sourceIndependence,/Not established/);
});
test('concordance is exact, passage-scoped commentary expands in bounded original-entry chunks',()=>{
 const pools=tools.findOccurrences({phrase:'pool of Siloam',books:['John'],limit:5});assert.ok(pools.results.some(r=>r.locator==='John 9:7'));
 assert.equal(tools.findOccurrences({phrase:'a completely invented phrase'}).sufficientEvidence,false);
 const notes=tools.searchReferences({passage:'John 9:1-11',types:['commentary'],limit:2});assert.equal(notes.results.length,2);assert.ok(notes.results.every(r=>r.locator==='John 9:7'));
 const context=tools.getSourceContext({citationId:notes.results[0].citationId,before:2,after:2});assert.ok(context.results.length<=5);assert.ok(context.results.every(r=>r.excerpt.length<=1200));
 assert.throws(()=>tools.getSourceContext({citationId:notes.results[0].citationId,after:20}),/bounded/);
 assert.throws(()=>tools.searchReferences({query:'x'.repeat(101)}),/bounded/);
 assert.equal(tools.getSourceContext({citationId:'unknown'}).sufficientEvidence,false);
});
