// Curated source/angle data, not approved questions. Every generated claim still
// needs exact passage evidence and two independent reviews. No outside facts.
const {scriptureEvidence}=require('./discoveryScripture');
const SCENES=[
 ['John 11:32-44','Use Martha’s warning about the tomb as context for the explicit number of days Lazarus had been dead.'],
 ['Luke 19:1-10','Connect Zacchaeus’s restitution pledge to its explicitly stated multiple.'],
 ['Mark 10:46-52','Connect Bartimaeus’s response to being called with the object he throws aside.'],
 ['1 Kings 19:9-13','Use the sequence of wind, earthquake and fire as context for the sound that follows. Preserve the account’s wording.'],
 ['John 2:1-10','Connect the wedding setting and filling to the brim with the explicit number of stone water pots.'],
 ['Judges 7:4-8','Use the unusual way of drinking water as context for the exact number of men retained.'],
 ['Mark 4:35-41','Use the storm and sleeping on a cushion to ask about Jesus’s explicitly named position in the boat.'],
 ['Mark 2:1-12','Connect the crowded house and lowered bed with the explicit number of people carrying the man.'],
 ['Luke 17:11-19','Connect the one healed man who returns and gives thanks with his explicitly stated identity.'],
 ['Mark 8:22-26','Use the man’s first, incomplete description of restored sight to ask what walking people looked like.'],
 ['Luke 10:30-35','In the parable, connect the innkeeper’s care with the exact amount of money handed over. Keep every option an exact amount, not overlapping expense categories.'],
 ['Luke 15:8-10','In the parable, connect lighting a lamp and sweeping the house with the lost object.'],
 ['Luke 15:20-24','In the parable, distinguish what is put on the son’s finger from what is put on his feet.'],
 ['Matthew 17:24-27','Connect the temple-tax instruction with the exact location where Peter is told he will find a coin.'],
 ['Matthew 26:14-16','Connect Judas’s agreement with the exact number of silver pieces.'],
 ['Mark 14:12-16','Connect the disciples’ directions through the city with the distinctive object carried by the man they follow.'],
 ['John 21:8-14','Connect the unbroken net with the exact counted number of fish.'],
 ['John 13:3-11','Connect the supper, removed garments and basin with the item Jesus wraps around himself.'],
 ['Acts 9:1-9','Connect Saul’s loss of sight with the exact number of days without food or drink.'],
 ['Acts 9:36-41','Connect the widows showing garments with the explicitly named disciple who made them. Do not make name aliases separate answer choices.'],
 ['Acts 12:6-11','Connect Peter’s chains and sleeping position with the explicit number of soldiers beside him.'],
 ['Acts 12:12-17','Connect recognizing Peter’s voice and leaving the gate shut in joy with the named servant girl.'],
 ['Acts 16:23-29','Connect the prisoners listening at midnight with what Paul and Silas do in addition to praying.'],
 ['Acts 20:7-12','Connect Eutychus’s sleep at the window with the explicitly numbered story from which he falls.'],
 ['Acts 28:1-6','Connect the fire and viper with the explicitly named island.'],
 ['1 Samuel 17:38-40','Connect David setting aside the armor with the exact number of smooth stones he selects.'],
 ['1 Kings 17:1-6','Connect the brook and morning/evening provisions with the birds named as bringing food.'],
 ['2 Kings 5:9-14','Connect Naaman’s instructions and initial anger with the exact number of times he washes in the Jordan.'],
 ['Jonah 1:1-6','Distinguish the port where Jonah finds a ship from his intended destination.'],
 ['Jonah 4:5-8','Connect Jonah’s shade plant with the creature appointed to damage it.'],
 ['Ruth 3:14-18','Connect Ruth’s return to her mother-in-law with the explicit quantity of barley.'],
 ['2 Kings 4:38-41','Connect the cry about the pot with the ingredient Elisha asks to have added. Describe only the narrative’s claim.'],
 ['Daniel 5:1-6','Connect the king’s feast and visible fingers with the surface on which the writing appears.'],
 ['Daniel 3:19-23','Connect the king’s fury with the explicit multiple in his order to heat the furnace. Treat it as an order in the account, not a measured historical temperature.'],
 ['Genesis 24:15-20','Connect Rebekah’s offer of water with the animals she also offers to water.'],
 ['Joshua 2:15-21','Connect the window and escape instructions with the color of the cord specified as a sign.'],
];
const NARRATIVE=new Set(['Genesis','Exodus','Numbers','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Daniel','Jonah','Matthew','Mark','Luke','John','Acts']);
function isNarrative(reference){return NARRATIVE.has(String(reference).replace(/\s+\d.*$/,''));}
function sceneFor(date,offset=0,corpus){const day=Math.floor((Date.parse(date+'T12:00:00Z')-Date.parse('2026-10-28T12:00:00Z'))/86400000);const index=((day+offset)%SCENES.length+SCENES.length)%SCENES.length;const [reference,angle]=SCENES[index];const evidence=scriptureEvidence(reference,corpus);return {sourceReference:evidence.source.locator,sourceSha256:evidence.sourceSha256,angle};}
function sourceOptions(date,primary,corpus){const options=[primary];for(const offset of [7,19,25]){const option=sceneFor(date,offset,corpus);if(!options.some(row=>row.sourceReference===option.sourceReference))options.push(option);if(options.length===3)break;}return options;}
module.exports={SCENES,isNarrative,sceneFor,sourceOptions};
