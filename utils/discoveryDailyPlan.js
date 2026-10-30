const {scriptureEvidence,loadCorpus}=require('./discoveryScripture');
const {VERSION:editorialVersion}=require('./discoveryEditorial');
const {VERSION:writerVersion}=require('./discoveryWriterPolicy');
const VERSION='discovery-daily-set-plan-v2';
// Plans, not questions or approvals. Distinct images/choices matter more than
// incidental numbers. Three trusted sources are frozen before each slot starts.
const SOURCES={
 easy:[
  ['1 Samuel 17:23-40','Use David testing and rejecting armor: a vivid familiar contrast, not a counted-stones question.'],
  ['Genesis 8:6-12','Use the dove and olive leaf; distinguish bird, object and action with believable parallel choices.'],
  ['Daniel 6:14-23','Use the named rescue scene and its distinctive animals or stated action; no inevitable-outcome quiz.'],
  ['Exodus 2:1-10','Use the basket, river or named relationship; preserve who sends whose servant.'],
  ['Daniel 5:1-9','Use the unexpected writing on the palace wall, not a number or an inferred omen.'],
  ['Mark 4:35-41','Use the cushion or unexpected sleeping scene, not the expected calming of the storm.'],
  ['John 20:11-18','Use Mary mistaking Jesus for the gardener; keep the mistaken identity explicit.'],
  ['Mark 10:46-52','Use the named encounter and a vivid object or action; no generic healing outcome.'],
  ['Acts 16:23-34','Use the surprising midnight singing; no routine release outcome or incidental count.'],
  ['Luke 19:1-10','Use the tree and the distinctive action; avoid arithmetic about restitution.'],
  ['Exodus 3:1-12','Use the unusual burning bush or stated physical action; no speculative symbolism.'],
  ['Numbers 22:22-35','Use the distinctive speaking animal or encounter; preserve attribution and stated actions.'],
 ],
 moderate:[
  ['John 9:1-11','Connect the clay, washing and named pool Siloam; use four real comparable pools or places.'],
  ['Acts 16:11-18','Connect Lydia with purple cloth; do not give away a different hospitality-city question.'],
  ['Acts 28:1-10','Connect the viper encounter and the island Malta; use credible comparable islands.'],
  ['2 Kings 5:9-19','Connect Naaman’s healing with his surprising request for earth; do not add an unstated trip home.'],
  ['2 Samuel 23:8-23','Distinguish Shammah and Benaiah through specific feats; never quiz isolated counts.'],
  ['Luke 8:40-56','Connect Jairus’s interrupted journey with the woman’s encounter; keep the two people clear.'],
  ['Ruth 4:1-12','Connect transfer of rights with the stated sandal custom, without invented historical symbolism.'],
  ['Acts 13:1-13','Use the Paphos encounter to distinguish city, magician or official through an explicit connection.'],
  ['Acts 12:12-19','Connect Rhoda recognizing a voice to leaving the gate unopened; explain the situation clearly.'],
  ['Luke 24:28-35','Connect recognition with the explicitly described shared action, preserving the literary frame.'],
  ['Jonah 4:5-11','Connect the shade and its loss to the stated creature, without inventing a motive.'],
  ['1 Kings 19:9-18','Distinguish dramatic events from the stated quiet encounter; avoid disputed translation trivia.'],
 ],
 challenging:[
  ['2 Samuel 15:22-37','Distinguish Hushai’s covert advisory role and Zadok’s reporting route. Ask one role, no answer giveaway.'],
  ['Genesis 44:15-34','Connect Judah’s pledge and proposed substitution, distinguishing the brothers through explicit roles.'],
  ['Acts 16:6-15','Distinguish Lydia’s home city from the city of this encounter and hospitality. Never imply a journey the passage does not state.'],
  ['Acts 9:26-39','Connect Tabitha’s garment-making, her town Joppa and Peter departing Lydda; distinguish roles of nearby cities.'],
  ['Acts 21:1-20','Distinguish Philip as host from Agabus’s belt prophecy through their stated actions.'],
  ['Genesis 24:15-32','Follow Laban seeing Rebekah’s jewelry and greeting the visitor. Preserve chronology; never infer greed or motive.'],
  ['Esther 6:1-14','Distinguish who proposes, receives and carries out the public honor; the reversal is the memorable discovery.'],
  ['1 Samuel 25:18-35','Connect Abigail’s intervention and David’s response using explicit roles, not counted gifts.'],
  ['Acts 18:24-28','Distinguish Apollos’s Alexandrian origin, instruction and destination. Do not invent a journey from Alexandria.'],
  ['Romans 16:1-16','Distinguish Phoebe’s association with Cenchreae and the named helpers; avoid adjudicating disputed church offices.'],
  ['1 Kings 22:13-28','Distinguish Micaiah’s warning and Ahab’s order. An order to jail him does not establish imprisonment already occurred.'],
  ['Acts 19:23-41','Connect Demetrius’s trade and stated concern for Artemis’s honor; do not claim the temple was physically damaged.'],
 ]
};
function buildDailySetPlan(date,corpus=loadCorpus()) {
 const n=Math.floor(Date.parse(date+'T12:00:00Z')/86400000);
 const usedChapters=new Set();
 const slots=Object.entries(SOURCES).map(([targetDifficulty,pool],index)=>{
  const candidates=[0,4,8,...Array.from({length:pool.length},(_,i)=>i)],sourceOptions=[];
  for(const offset of candidates){
   const [reference,angle]=pool[((n+offset)%pool.length+pool.length)%pool.length];
   const chapter=reference.replace(/:\d.*$/,'');
   if(usedChapters.has(chapter))continue;
   const evidence=scriptureEvidence(reference,corpus);usedChapters.add(chapter);
   sourceOptions.push({sourceReference:evidence.source.locator,sourceSha256:evidence.sourceSha256,angle});
   if(sourceOptions.length===3)break;
  }
  if(sourceOptions.length!==3)throw new Error('Three distinct precommitted sources per difficulty are required.');
  return {position:index+1,targetDifficulty,sourceOptions};
 });
 return {version:VERSION,date,editorialVersion,writerVersion,corpusVersion:corpus.version,corpusSha256:corpus.sha256,theme:'Three discoveries worth sharing',learningGoal:'Enjoy one accessible fact, one grounded connection and one fair closer-reading challenge.',slots};
}
module.exports={VERSION,SOURCES,buildDailySetPlan};
