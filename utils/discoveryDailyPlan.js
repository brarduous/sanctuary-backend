const {scriptureEvidence,loadCorpus}=require('./discoveryScripture');
const {VERSION:editorialVersion}=require('./discoveryEditorial');
const {VERSION:writerVersion}=require('./discoveryWriterPolicy');
const VERSION='discovery-daily-set-plan-v3';
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
  ['Luke 5:1-11','Name Simon and the fishing scene; connect empty nets and Jesus’s instruction. No counts or specialist vocabulary.'],
  ['Luke 8:40-56','Connect Jairus’s interrupted journey with the woman’s encounter; keep the two people clear.'],
  ['Ruth 4:1-12','Connect transfer of rights with the stated sandal custom, without invented historical symbolism.'],
  ['Matthew 2:1-12','Name the visitors following the star; use one familiar gift or action, never an assumed number of visitors.'],
  ['Acts 12:12-19','Connect Rhoda recognizing a voice to leaving the gate unopened; explain the situation clearly.'],
  ['Luke 24:28-35','Connect recognition with the explicitly described shared action, preserving the literary frame.'],
  ['Jonah 4:5-11','Connect the shade and its loss to the stated creature, without inventing a motive.'],
  ['1 Kings 19:9-18','Distinguish dramatic events from the stated quiet encounter; avoid disputed translation trivia.'],
 ],
 challenging:[
  ['1 Samuel 17:23-40','Use familiar David and Goliath context to connect David, the offered armor and his choice. No minor names or counts.'],
  ['Genesis 37:18-36','Use Joseph and his brothers as the named familiar scene; connect the robe and its use as supposed evidence. No trader-name distinctions.'],
  ['Matthew 14:22-33','Name the familiar boat-and-storm scene; connect Peter, walking on the water and his call for help. No expected rescue-outcome quiz.'],
  ['Luke 10:25-37','Frame the Good Samaritan explicitly as a parable. Connect the traveler, the helper and the inn through concrete actions. No counts or monetary conversion.'],
  ['John 13:1-17','Name Jesus washing the disciples’ feet; connect Peter’s response with the towel or basin. No specialist vocabulary.'],
  ['Genesis 24:15-32','Name Rebekah and the well scene; connect water offered to the visitor and his camels. Do not infer motives or test Laban’s chronology.'],
  ['Esther 6:1-14','Name Esther’s familiar story and clearly introduce Mordecai and Haman; use the surprising public honor, not a bare minor-name lookup.'],
  ['Exodus 16:13-26','Name the manna story; connect daily gathering and the day of rest. No incidental quantities or verse-number recall.'],
  ['Luke 15:16-32','Frame the returning son as a parable; connect the father’s welcome and a concrete object or action. No moralizing or inevitable forgiveness-outcome quiz.'],
  ['John 11:17-35','Name Lazarus, Martha and Mary and the familiar setting clearly; use one modest connection and a concrete action. No ages or elapsed-day counts.'],
  ['Mark 2:1-12','Name the crowded-house scene; connect the paralyzed man’s friends, the roof and the mat. Avoid generic successful healing outcomes.'],
  ['Acts 9:1-19','Name Saul’s Damascus encounter; connect the road, the light and Ananias’s help with clear context. No minor street-name recall.'],
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
 return {version:VERSION,date,editorialVersion,writerVersion,corpusVersion:corpus.version,corpusSha256:corpus.sha256,theme:'Three discoveries worth sharing',learningGoal:'Gain biblical knowledge and confidence through familiar stories, helpful context and one memorable discovery per answer.',slots};
}
module.exports={VERSION,SOURCES,buildDailySetPlan};
