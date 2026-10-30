const {scriptureEvidence,loadCorpus}=require('./discoveryScripture');
const VERSION='discovery-daily-set-plan-v1';
// Plans, not questions or approvals. Distinct images/choices matter more than
// incidental numbers. Three trusted sources are frozen before each slot starts.
const SOURCES={
 easy:[
  ['Luke 19:1-10','Choose the distinctive tree or concrete action; no numerical restitution quiz.'],
  ['Mark 8:14-26','The unusual walking-tree image is the discovery, not the expected successful healing.'],
  ['Exodus 3:1-12','Choose the unusual object or place in the encounter; use only the source’s explicit imagery.'],
  ['John 13:1-11','Choose an unexpected concrete action or object from this scene.'],
  ['Genesis 8:6-12','Distinguish the returned bird’s object from generic signs of survival.'],
  ['Luke 15:3-10','Keep the parable frame; choose a vivid search action or object, not an incidental count.'],
  ['Daniel 5:1-9','Choose a memorable unexpected visual detail of the feast.'],
  ['Numbers 22:22-35','Use the distinctive encounter; no speculative motives or generic rescue outcome.'],
  ['Mark 4:35-41','Choose the unexpected image during the storm rather than the storm calming.'],
  ['Matthew 17:24-27','Choose the unusual place where the coin is found, with credible parallel places.'],
  ['Acts 16:23-34','Choose the surprising midnight action rather than the prisoners being released.'],
  ['Genesis 11:1-9','Choose the building material or a distinctive stated detail, never an imagined motive.'],
 ],
 moderate:[
  ['Acts 12:12-19','Connect recognizing a voice to the surprising action at the unopened gate. Explain the situation clearly for newcomers.'],
  ['Mark 10:46-52','Connect the named person, being called, and an object left behind.'],
  ['Luke 17:11-19','Connect the returning person’s action and stated identity, without incidental count recall.'],
  ['John 20:11-18','Use recognition and a specific stated word or action; preserve who speaks to whom.'],
  ['Luke 24:28-35','Connect recognition with the explicitly described shared action.'],
  ['1 Kings 19:9-18','Distinguish the expected dramatic events from the stated quiet encounter.'],
  ['Jonah 4:5-11','Connect the shade, its loss, and a stated creature, without inventing a moral.'],
  ['2 Kings 5:9-16','Connect Naaman’s expectations to the unexpected instructions; avoid a number-of-washes quiz.'],
  ['Acts 8:26-36','Connect the traveler’s role and reading to the named encounter.'],
  ['John 21:1-14','Use the recognition scene and a particular action or object; avoid counted fish.'],
  ['Luke 10:38-42','Connect a named person to the contrast of actions; do not adjudicate an unstated doctrine.'],
  ['1 Samuel 17:38-51','Connect rejected equipment and the specific alternative, without a count question.'],
 ],
 challenging:[
  ['Genesis 40:5-22','Distinguish the two prisoners through their contrasting dream details and outcomes. Connect explicit clues; avoid obvious occupational word associations.'],
  ['2 Samuel 12:1-13','Preserve Nathan’s parable frame. Connect multiple details to distinguish an action or person without giving away the key.'],
  ['1 Samuel 25:18-35','Follow a specific intervention and the speaker’s response. Use two explicit details to distinguish closely related named people or actions.'],
  ['Acts 9:36-43','Connect garments shown by the widows, the named disciple, and a stated action. Never make aliases competing options.'],
  ['Ruth 4:1-12','Connect the nearer relative’s decision with the transfer of rights and a concrete stated custom; no historical inference.'],
  ['Daniel 2:31-45','Connect at least two explicit features of the image, keeping the dream and interpretation separate. No inferred symbolism beyond the text.'],
  ['Acts 18:24-28','Connect teaching, who instructed whom, and a named place. Use clear clues to distinguish the people without name-alias alternatives.'],
  ['2 Kings 6:8-23','Follow two contrasting sight-related actions and the stated treatment of the captured group. No inevitable-success question.'],
  ['Genesis 44:18-34','Connect the speaker’s pledge and proposed substitution using explicit relational clues.'],
  ['Joshua 2:8-21','Connect the agreement, the escape and the stated identifying sign; never invent modern meanings.'],
  ['Acts 16:11-18','Distinguish two encounters through the person’s occupation, response or explicitly named city.'],
  ['1 Kings 17:8-24','Distinguish two interventions through multiple explicit actions or objects, without requiring an inferred motive.'],
 ]
};
function buildDailySetPlan(date,corpus=loadCorpus()) {
 const n=Math.floor(Date.parse(date+'T12:00:00Z')/86400000);
 return {version:VERSION,date,corpusVersion:corpus.version,corpusSha256:corpus.sha256,theme:'Three discoveries worth sharing',learningGoal:'Enjoy one accessible fact, one grounded connection and one fair closer-reading challenge.',slots:Object.entries(SOURCES).map(([targetDifficulty,pool],index)=>({position:index+1,targetDifficulty,sourceOptions:[0,4,8].map(offset=>{
  const [reference,angle]=pool[((n+offset)%pool.length+pool.length)%pool.length];
  const evidence=scriptureEvidence(reference,corpus);
  return {sourceReference:evidence.source.locator,sourceSha256:evidence.sourceSha256,angle};
 })}))};
}
module.exports={VERSION,SOURCES,buildDailySetPlan};
