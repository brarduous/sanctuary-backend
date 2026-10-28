const {localDate,shiftDate}=require('./discoveries');
const {scriptureEvidence,contextualEvidence}=require('./discoveryScripture');
const VERSION='discovery-biblical-curriculum-v2';
const chapterRange=(book,count,start=1)=>Array.from({length:count},(_,i)=>`${book} ${start+i}`);
const MODULES=[
  ['Creation and covenant','Notice the people, signs, and settings named in Genesis.',chapterRange('Genesis',28)],
  ['Exodus and wilderness','Follow the events and objects named in the Exodus accounts.',[...chapterRange('Exodus',21),...chapterRange('Numbers',7)]],
  ['Israel’s stories','Distinguish the named people and actions in Israel’s narratives.',['Joshua 1','Joshua 2','Joshua 3','Joshua 4','Joshua 5','Joshua 6','Judges 4','Judges 6','Judges 7','Ruth 1','Ruth 2','Ruth 3','Ruth 4','1 Samuel 1','1 Samuel 3','1 Samuel 8','1 Samuel 9','1 Samuel 16','1 Samuel 17','1 Samuel 24','2 Samuel 5','2 Samuel 7','2 Samuel 9','2 Samuel 12','1 Kings 3','1 Kings 8','1 Kings 17','1 Kings 19']],
  ['Exile and return','Read what the texts say about named places and encounters.',['2 Kings 2','2 Kings 4','2 Kings 5','2 Kings 6','2 Kings 18','2 Kings 19','2 Kings 22','2 Kings 23','2 Kings 24','2 Kings 25','Daniel 1','Daniel 2','Daniel 3','Daniel 4','Daniel 5','Daniel 6','Ezra 1','Ezra 3','Ezra 6','Ezra 7','Nehemiah 1','Nehemiah 2','Nehemiah 4','Nehemiah 6','Nehemiah 8','Nehemiah 9','Esther 2','Esther 4']],
  ['Poetry and wisdom','Identify the text’s stated images without treating poetry as a literal guarantee.',['Psalms 23','Psalms 46','Psalms 51','Psalms 78','Psalms 90','Psalms 100','Psalms 103','Psalms 104','Psalms 107','Psalms 111','Psalms 119','Psalms 121','Psalms 127','Psalms 130','Psalms 139','Psalms 145','Psalms 146','Psalms 147','Psalms 148','Psalms 149','Psalms 150','Proverbs 1','Proverbs 3','Proverbs 8','Proverbs 15','Ecclesiastes 3','Job 38','Job 42']],
  ['The prophets’ words','Notice explicit textual details while preserving literary setting.',['Isaiah 6','Isaiah 9','Isaiah 11','Isaiah 40','Isaiah 55','Isaiah 58','Isaiah 61','Jeremiah 1','Jeremiah 18','Jeremiah 29','Jeremiah 31','Ezekiel 1','Ezekiel 3','Ezekiel 34','Ezekiel 36','Ezekiel 37','Hosea 1','Hosea 6','Hosea 11','Joel 2','Amos 5','Jonah 1','Jonah 2','Jonah 3','Jonah 4','Micah 6','Habakkuk 3','Zechariah 9']],
  ['Matthew’s account','Recognize details stated in Matthew without conflating Gospel accounts.',chapterRange('Matthew',28)],
  ['Encounters with Jesus','Follow the named actions and settings in the supplied account.',[...chapterRange('Mark',16),...chapterRange('Luke',12)]],
  ['Luke and John','Distinguish the particular scene and wording each account presents.',[...chapterRange('Luke',12,13),...chapterRange('John',16)]],
  ['John and the early church','Notice named people, objects, and places in John and Acts.',[...chapterRange('John',5,17),...chapterRange('Acts',23)]],
  ['Acts and Romans','Read the explicit details of the journey and letter.',[...chapterRange('Acts',5,24),...chapterRange('Romans',16),...chapterRange('1 Corinthians',7)]],
  ['Life in the early churches','Identify the examples and images that the supplied letters actually use.',[...chapterRange('1 Corinthians',9,8),...chapterRange('2 Corinthians',13),...chapterRange('Galatians',6)]],
  ['Letters and hope','Recognize textual images and named examples without resolving doctrinal disputes.',['Ephesians 2','Ephesians 4','Ephesians 6','Philippians 2','Philippians 4','Colossians 1','Colossians 3','Hebrews 11','Hebrews 12','James 1','James 2','James 3','James 5','1 Peter 1','1 Peter 2','1 Peter 4','1 John 1','1 John 3','1 John 4','Revelation 1','Revelation 2','Revelation 3','Revelation 4','Revelation 5','Revelation 7','Revelation 21','Revelation 22','Philemon 1']],
];
const ANGLES=['identify a person through a concrete action and scene','connect a place to a distinctive event described there','connect an explicit action to its stated circumstance','use an object or image as a clue to a supported connection','make the setting useful to the answer rather than decorative','connect two events whose sequence is explicit in the passage','explore a distinctive phrase through its immediate context'];
const DIFFICULTIES=['easy','moderate','easy','moderate','challenging','moderate','easy'];
function monday(date) {const day=new Date(`${date}T12:00:00Z`).getUTCDay();return shiftDate(date,-((day+6)%7));}
function buildWeekPlan(startDate,{devotionals=[],corpus}={}) {
  const start=monday(startDate);
  const weekIndex=Math.max(0,Math.floor((Date.parse(start)-Date.parse('2026-10-26'))/(7*86400000)));
  const moduleIndex=weekIndex%MODULES.length;
  const cycle=Math.floor(weekIndex/MODULES.length)%4;
  const [theme,goal,chapters]=MODULES[moduleIndex];
  const days=Array.from({length:7},(_,offset)=>{
    const date=shiftDate(start,offset);
    const devotional=devotionals.find(row=>row.date===date);
    let evidence,aligned=false;
    if(devotional?.scripture_reference) {
      try {evidence=contextualEvidence(devotional.scripture_reference,corpus);aligned=true;} catch { /* Use the explicit curriculum source, never invented Scripture. */ }
    }
    if(!evidence)evidence=scriptureEvidence(chapters[cycle*7+offset],corpus);
    return {date,angle:ANGLES[offset],targetDifficulty:DIFFICULTIES[offset],sourceReference:evidence.source.locator,sourceSha256:evidence.sourceSha256,devotionalAligned:aligned};
  });
  return {version:VERSION,startDate:start,endDate:shiftDate(start,6),weekNumber:weekIndex%52+1,theme,learningGoal:goal,corpusVersion:scriptureEvidence(days[0].sourceReference,corpus).corpusVersion,days};
}
module.exports={VERSION,MODULES,ANGLES,DIFFICULTIES,monday,buildWeekPlan};
