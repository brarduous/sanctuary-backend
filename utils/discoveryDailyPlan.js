const {scriptureEvidence,loadCorpus}=require('./discoveryScripture');
const {VERSION:editorialVersion}=require('./discoveryEditorial');
const {VERSION:writerVersion}=require('./discoveryWriterPolicy');
const VERSION='discovery-daily-set-plan-v4';
// Plans, not questions or approvals. Distinct images/choices matter more than
// incidental numbers. Three trusted sources are frozen before each slot starts.
const SOURCES={
 easy:[
  ['Genesis 6:13-22','Name Noah and the flood; ask about the ark, not wood, measurements or numbers.'],
  ['Daniel 6:14-23','Name Daniel in the den; identify the lions, no obscure details.'],
  ['Exodus 3:1-12','Name Moses and the unusual burning plant; ask about the bush, not a place or count.'],
  ['1 Samuel 17:23-40','Name David facing the giant; ask the widely known identity Goliath, not armor or numbers.'],
  ['Luke 2:1-14','Name the birth of Jesus; use the manger as a concrete, familiar image.'],
  ['John 2:1-11','Name Jesus at the wedding; use water becoming wine, no counts or place-name recall.'],
  ['Genesis 9:12-17','Name Noah after the flood; ask about the rainbow as a visible sign.'],
  ['Exodus 2:1-10','Name baby Moses by the river; use the basket, no obscure names.'],
  ['Matthew 2:1-12','Name the visitors seeking the child Jesus; use the star guiding them, no counts.'],
  ['Luke 19:1-10','Name the short man Zacchaeus trying to see Jesus; use climbing a tree, no species.'],
  ['Matthew 14:22-33','Name Jesus approaching the boat; use walking on water, no chronology or names beyond Peter.'],
  ['Genesis 3:1-13','Frame the garden story clearly; ask about the speaking serpent, not theology or interpretation.'],
 ],
 moderate:[
  ['Exodus 3:1-12','Name Moses and the burning bush. Ask about removing sandals with a helpful clue, not a place name.'],
  ['Matthew 2:1-12','Name the visitors following the star; ask about a familiar gift, never number or obscure titles.'],
  ['Luke 19:1-10','Name Zacchaeus and the crowd; use the familiar climb to see Jesus, not tree species or restitution.'],
  ['Genesis 8:6-12','Name Noah after the flood; connect the bird returning with an olive leaf. No chronology or counts.'],
  ['Mark 4:35-41','Name Jesus and the boat in the storm; use his sleeping on a cushion, no nautical vocabulary.'],
  ['John 13:1-17','Name Jesus and the disciples; ask about the towel or basin, with a clear clue about washing feet.'],
  ['Luke 15:16-32','Frame the returning son as a parable. Use the father welcoming his son, a ring or a robe with clear context.'],
  ['Exodus 2:1-10','Name baby Moses at the river; use the basket or family relationship, no minor-name recall.'],
  ['Numbers 22:22-35','Introduce Balaam and the unusual encounter clearly; ask about the talking donkey, no minor roles.'],
  ['Daniel 6:14-23','Name Daniel and the lions; ask about the angel in the rescue with a helpful contextual clue.'],
  ['1 Samuel 17:23-40','Name David preparing to face Goliath; use offered armor and its rejection, no counts.'],
  ['John 20:11-18','Name Mary encountering Jesus outside the tomb; use the gardener mistake with helpful context.'],
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
 return {version:VERSION,date,editorialVersion,writerVersion,corpusVersion:corpus.version,corpusSha256:corpus.sha256,theme:'Three discoveries worth sharing',learningGoal:'Build confidence with widely known stories: Easy recognition, Medium a familiar detail with a clue, Hard one attainable connection. No specialist recall in any slot.',slots};
}
module.exports={VERSION,SOURCES,buildDailySetPlan};
