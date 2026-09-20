import {createState,queueMove,queueTurn,cancelMotion,updateWorld,nearestDoor,setDoor,nearestInteraction,regionAt,doorPosition,WALLS} from './world.mjs';
import {HotelAudio} from './audio.mjs';
import {NavigationHint,navigationGoal,relativeDirection} from './navigation-hint.mjs';
import {planAssistance} from './navigation-assist.mjs';
import {TrailMap} from './trail-map.mjs';
import {VoiceInput} from './voice-input.mjs';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const silent=params.get('silent')==='1',debug=params.get('debug')==='1';
const identities={martin:'Martin · Receptionist',claire:'Claire · Witness',elena:'Elena · Witness',cleaner:'Hotel cleaner'};
const titles={guide:'Gemini · your companion',...identities};
const personLabel=value=>identities[String(value).toLowerCase()]||value;
const initial={martin:'MARTIN-INITIAL',claire:'CLAIRE-INITIAL',elena:'ELENA-INITIAL'};
const witnessNotes={martin:'Martin · Receptionist: heard English and a second voice he thought was Italian.',claire:'Claire · Witness: heard English and a second voice she thought was German.',elena:'Elena · Witness: heard English and a second voice she thought was French.'};
const questionOptions={claire:[['Do you speak German?','CLAIRE-GERMAN'],['Which words did you hear?','CLAIRE-WORDS']],martin:[['Do you speak Italian?','MARTIN-ITALIAN'],['Did you recognize German?','MARTIN-GERMAN']],elena:[['Do you speak French?','ELENA-FRENCH-R2'],['Did you recognize Italian?','ELENA-ITALIAN']]};
let state=createState(),data=null,started=false,starting=false,role='guide',collected=new Set(),notes=new Map(),history=[],recordingHeard=false;
let foreground=false,speechEpoch=0,requestEpoch=0,passingStarted=false,passingComplete=false,passingMotion=null,welcomed=false;
let investigationSeconds=0,hintSent=false,revealSent=false,frameTime=null,lastDebug=0,contextKey='',suggestionKey='',runNumber=0;
let ttsController=null,routeBusy=false,voiceReady=false,recording=false,routeEpoch=0,pendingSubmission=false;
const MAX_SEARCH_ATTEMPTS=5;
let searchAttempts=0,lastTrailFrame=0,assistance=null;
const navigationHint=new NavigationHint(),trailMap=new TrailMap($('trail-canvas'));
const audio=new HotelAudio({silent,onError:error=>notice(typeof error==='string'?error:error.message,true)});
const voice=new VoiceInput({isAllowed:()=>started&&!state.paused&&state.phase!=='ending',
  getContext:()=>({context:{role:effectiveRole(),submit:pendingSubmission,collected:[...collected],recordingHeard,phase:state.phase,player:{...state.player}},history:history.slice(-8)}),
  onLevel:level=>$('chat').dispatchEvent(new CustomEvent('voice-level',{detail:level})),
  onState:({state:status,message})=>{recording=status==='recording';$('chat').dataset.voiceState=status;$('talk').setAttribute('aria-pressed',String(recording));$('talk').textContent=recording?'Release':'Speak';audio.setListening?.(recording);if(status==='error'||status==='unavailable')notice(message,true);else if(status==='transcribing')notice('Gemini is considering what you said…');renderControls();},
  onTranscript:result=>void receiveReply(result)});

function notice(text,error=false){$('notice').textContent=text;$('notice').dataset.error=String(error);}
function log(speaker,text,kind='assistant'){
  const item=document.createElement('div');item.className='message';item.dataset.kind=kind;
  const label=document.createElement('span');label.className='message-label';label.textContent=personLabel(speaker);
  item.append(label,document.createTextNode(text));$('chat-log').append(item);
  while($('chat-log').children.length>70)$('chat-log').firstElementChild.remove();
  $('chat-log').scrollTop=$('chat-log').scrollHeight;
}
function remember(role,text){history.push({role,text:String(text).slice(0,600)});history=history.slice(-8);}
function addNote(id,text,clipId){notes.set(id,{text,clipId});$('note-count').textContent=notes.size;renderNotes();}
function renderNotes(){
  $('note-list').replaceChildren();
  if(!notes.size){const p=document.createElement('p');p.textContent='Your observations will appear here.';$('note-list').append(p);}
  for(const [id,note]of notes){const item=document.createElement('div');item.className='note-item';const p=document.createElement('p');p.textContent=note.text;item.append(p);
    if(note.clipId){const b=document.createElement('button');b.textContent='Replay';b.onclick=()=>note.clipId==='incident'?void playIncident(true):void replayMemory(note.clipId);item.append(b);}
    $('note-list').append(item);
  }
}
function effectiveRole(){
  if(role==='guide')return role;
  const near=nearestInteraction(state);if(!near||near.id!==role){role='guide';return role;}return role;
}
function selectRole(next){role=next;renderContext();renderSuggestions();$('speaker-title').textContent=titles[role]||titles.guide;}
function cancelRequest(){pendingSubmission=false;requestEpoch++;voice.cancel();ttsController?.abort();ttsController=null;}
function stopSpeech(){stopAssistance();speechEpoch++;audio.stopGroup('foreground');audio.stopGroup('guide');foreground=false;cancelRequest();}
async function playClip(id,{sourceId,collect=false,memory=false}={}){
  if(!started||state.paused||state.phase==='ending'||!data.speech[id])return false;
  const clip=data.speech[id],epoch=speechEpoch,run=runNumber;
  foreground=true;log(memory?'Recalled · '+personLabel(clip.name):personLabel(clip.name),clip.subtitle_en);notice('Listening…');
  const ended=await audio.play(id,{sourceId:memory?undefined:sourceId,kind:'speech',group:'foreground'});
  if(epoch!==speechEpoch||run!==runNumber)return false;
  foreground=false;
  if(ended&&collect){collected.add(id);const who=sourceId||clip.name.toLowerCase();addNote(id,id===initial[who]?witnessNotes[who]:personLabel(who)+': '+clip.subtitle_en,id);}
  if(ended&&id==='DLG-03-EN-R4'){collected.add(id);addNote(id,'Elena · Witness (passing conversation): Jake was the only zoologist in town.',id);}
  notice(ended?'': 'Playback stopped. You can replay it.');renderSuggestions();return ended;
}
async function replayMemory(id){stopSpeech();await playClip(id,{memory:true});}
async function talkTo(id){
  if(!started||state.paused||state.stairs||state.phase==='ending')return;
  const near=nearestInteraction(state);if(!near||near.id!==id)return notice('Move closer before speaking to them.');
  stopSpeech();cancelMotion(state);selectRole(id);
  if(initial[id])await playClip(initial[id],{sourceId:id,collect:true});
  else if(id==='cleaner')await playClip('DLG-06',{sourceId:'cleaner',collect:true});
  renderSuggestions();
}
async function followup(id){
  const who=effectiveRole();if(who==='guide')return;
  stopSpeech();await playClip(id,{sourceId:who,collect:true});
}
async function playPassing(replay=false){
  if(!started||state.paused||state.phase==='ending'||foreground)return;
  if(passingStarted&&!replay)return;
  passingStarted=true;const epoch=speechEpoch,run=runNumber;
  passingMotion={elapsed:0,startClaire:{...state.sources.claire},startElena:{...state.sources.elena}};
  for(const [id,person]of [['DLG-02-EN-R3','claire'],['DLG-03-EN-R4','elena'],['DLG-04-EN-R4','claire'],['DLG-05-EN-R3','elena']]){
    if(epoch!==speechEpoch||run!==runNumber)return;
    const ended=await playClip(id,{sourceId:person});if(!ended)return;
  }
  passingComplete=true;notice('');
}
async function playIncident(memory=false){
  if(!started||state.paused||state.phase==='ending')return;
  if(!memory&&nearestInteraction(state)?.id!=='recorder')return notice('The recorder is still out of reach.');
  if(!data.catalog.assets.incident)return notice('The incident recording could not be loaded. Please retry.',true);
  stopSpeech();cancelMotion(state);selectRole('guide');foreground=true;
  const epoch=speechEpoch,run=runNumber;notice('The recording is playing. Listen to both sounds.');
  log(memory?'Replay':'Recorder','The recording from that night begins.');
  void audio.play('recorder-click',{sourceId:'recorder',kind:'effect',group:'effects'});
  const ended=await audio.play('incident',{sourceId:memory?undefined:'recorder',kind:'evidence',group:'foreground'});
  if(epoch!==speechEpoch||run!==runNumber)return;foreground=false;
  if(ended){
    if(!recordingHeard)investigationSeconds=0;
    recordingHeard=true;
    addNote('incident','The recording: a man speaks understandable English. A second harsh, irregular vocalization overlaps him; no recognizable words can be made out.','incident');
    log('Gemini','What do you think the second sound was? Compare what you heard with what each witness believed.');
    notice('Recording finished. You can replay it or submit your explanation.');
  }else notice('Recording stopped before the end. Play it again when you are ready.');
}
function useDoor(){
  if(!started||state.paused||state.stairs||state.phase==='ending')return false;
  stopAssistance();
  const door=nearestDoor(state);if(!door)return false;
  cancelRequest();cancelMotion(state);
  if(!setDoor(state,door.id,state.doorTargets[door.id]<.5)){notice('Step clear of the doorway before closing it.');return false;}return true;
}
function interactionTarget(){
  if(!started||state.paused||state.stairs||state.phase==='ending')return null;
  const door=nearestDoor(state),near=nearestInteraction(state),candidates=[];
  if(door)candidates.push({...door,type:'door'});
  if(near)candidates.push({...near,position:state.sources[near.id]});
  for(const candidate of candidates){
    const dx=candidate.position.x-state.player.x,dy=candidate.position.y-state.player.y;
    candidate.bearing=candidate.distance<.1?0:Math.atan2(Math.sin(Math.atan2(dx,dy)-state.player.heading),Math.cos(Math.atan2(dx,dy)-state.player.heading));
    candidate.inFront=Math.abs(candidate.bearing)<=Math.PI/3;
  }
  candidates.sort((a,b)=>Number(b.inFront)-Number(a.inFront)||(a.inFront&&Math.abs(Math.abs(a.bearing)-Math.abs(b.bearing))>Math.PI/12?Math.abs(a.bearing)-Math.abs(b.bearing):a.distance-b.distance));
  return candidates[0]||null;
}
function interact(){
  if(!started||state.paused||state.stairs||state.phase==='ending')return;
  if(searchAttempts>=MAX_SEARCH_ATTEMPTS){notice('No search attempts remaining. Review your notes or restart.',true);return;}
  stopAssistance();
  searchAttempts++;
  const target=interactionTarget();
  if(!target){
    notice(`Nothing found here. ${MAX_SEARCH_ATTEMPTS-searchAttempts} search attempts remaining.`,true);
    if(searchAttempts>=MAX_SEARCH_ATTEMPTS){finish(false,'Five search attempts used up this round. Return to the entrance to try again.');$('ending-status').textContent='SEARCH ENDED';$('ending-title').textContent='Listen, then look closer.';notice('No searches remaining. Start a new round.',true);}
    renderWorldHud();return;
  }
  if(target.type==='door')useDoor();else if(target.type==='recorder')void playIncident();else if(target.type==='npc')void talkTo(target.id);
}
function renderWorldHud(){
  const active=started&&state.phase!=='ending';$('orientation').hidden=!active;$('trail-map').hidden=!active;
  const chatLog=$('chat-log'),followLog=chatLog.scrollHeight-chatLog.clientHeight-chatLog.scrollTop<24;
  const priorLayout=$('chat').dataset.worldPrompt+':'+$('chat').dataset.listening;
  $('chat').dataset.listening=String(foreground);
  if(!active){$('interaction-prompt').hidden=true;$('chat').dataset.worldPrompt='false';return;}
  const degrees=((state.player.heading*180/Math.PI)%360+360)%360;
  const headings=['North','Northeast','East','Southeast','South','Southwest','West','Northwest'];
  const heading=headings[Math.round(degrees/45)%8];
  $('compass-arrow').style.transform=`rotate(${degrees}deg)`;
  $('facing').textContent=`Facing ${heading} · ${String(Math.round(degrees)%360).padStart(3,'0')}°`;
  $('orientation').setAttribute('aria-label',$('facing').textContent);
  $('floor-label').textContent=state.stairs?(state.stairs.to===1?'Going upstairs':'Going downstairs'):(state.player.floor===0?'Ground floor':'Upper floor');
  $('trail-floor').textContent=state.player.floor===0?'GROUND FLOOR':'UPPER FLOOR';
  $('search-budget').textContent=`Checks left ${MAX_SEARCH_ATTEMPTS-searchAttempts} / ${MAX_SEARCH_ATTEMPTS}`;$('search-budget').dataset.low=String(searchAttempts>=3);
  const target=interactionTarget(),show=!!target&&!foreground&&!assistance&&$('notes').hidden&&$('settings').hidden;
  $('interaction-prompt').hidden=!show;$('chat').dataset.worldPrompt=String(show);
  if(followLog&&priorLayout!==String(show)+':'+String(foreground))chatLog.scrollTop=chatLog.scrollHeight;
  if(!show)return;
  const doorNames={entrance:'entrance',lounge:'lounge door',recording:'recorder room door',linen:'linen room door'};
  $('interaction-label').textContent=target.type==='door'?`${state.doorTargets[target.id]>.5?'Close':'Open'} ${doorNames[target.id]}`:target.type==='recorder'?'Play recording':`Talk to ${personLabel(target.id)}`;
  $('interaction-bearing').textContent=relativeDirection(target.bearing);
}
function explorationActive(){
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  return started&&!state.paused&&!state.stairs&&state.phase!=='ending'&&!foreground&&!typing&&!routeBusy&&voice.state!=='recording'&&voice.state!=='transcribing'&&$('notes').hidden&&$('settings').hidden;
}
function updateNavigationHint(dt){
  const active=explorationActive()&&!assistance;
  const goal=active?navigationGoal(state,collected,recordingHeard):null;
  const hint=navigationHint.update({goal,player:state.player,dt,active});
  $('direction-hint').hidden=!hint;
  if(hint){
    const degrees=hint.bearing*180/Math.PI;$('hint-arrow').style.transform=`rotate(${degrees}deg)`;
    $('hint-text').textContent=`Sound: ${relativeDirection(hint.bearing).toLowerCase()}`;
  }
  if(active&&navigationHint.lostSeconds>=30&&!state.motion&&!state.motionQueue.length)startAssistance(goal);
}
function stopAssistance(message=''){
  if(!assistance)return;
  assistance=null;cancelMotion(state);navigationHint.reset();$('assist-status').hidden=true;
  if(message)notice(message);
}
function startAssistance(goal){
  if(!goal||!explorationActive()||assistance)return;
  const plan=planAssistance(state,goal,2);navigationHint.reset();
  if(!plan.points.length){
    if(plan.stopReason==='door')notice('A door is within reach.');
    return;
  }
  cancelRequest();cancelMotion(state);selectRole('guide');
  assistance={...plan,index:0,travelled:0,last:{...state.player},elapsed:0};
  log('Gemini','I’ll guide you a few steps toward the sound. You can take over at any time.');
  notice('Gemini navigation assistance · you can take over at any time.');
  $('assist-status').hidden=false;$('direction-hint').hidden=true;
}
function updateAssistance(dt){
  if(!assistance)return;
  if(!explorationActive()){stopAssistance();return;}
  const run=assistance,p=state.player;
  run.elapsed+=dt;run.travelled+=Math.hypot(p.x-run.last.x,p.y-run.last.y);run.last={...p};
  if(run.elapsed>12){stopAssistance('Your turn. Listen again, then choose your next step.');return;}
  if(run.elapsed<.9||state.motion||state.motionQueue.length)return;
  if(run.travelled>=2-.001||run.index>=run.points.length){
    stopAssistance(run.stopReason==='door'?'You are near the doorway.':run.stopReason==='target'?'The sound is close.':run.stopReason==='stairs'?'The stairs are ahead. Take the next step when you are ready.':'Your turn. Listen again, then choose your next step.');return;
  }
  const point=run.points[run.index],dx=point.x-p.x,dy=point.y-p.y,d=Math.hypot(dx,dy);
  if(d<.025){run.index++;return;}
  const target=Math.atan2(dx,dy),turn=Math.atan2(Math.sin(target-p.heading),Math.cos(target-p.heading))*180/Math.PI;
  if(Math.abs(turn)>.3)queueTurn(state,Math.sign(turn)*Math.min(90,Math.abs(turn)));
  else queueMove(state,Math.min(.5,d,Math.max(0,2-run.travelled)));
}
function move(action){
  if(!started||state.paused||state.phase==='ending'||state.stairs)return;
  stopAssistance();
  cancelRequest();
  if(action==='forward'||action==='back')queueMove(state,action==='forward'?.5:-.5);
  else queueTurn(state,action==='right'?30:-30);
}
function renderControls(){
  const inactive=!started||state.paused||state.phase==='ending';
  $('send').disabled=inactive||!voiceReady||voice.state==='transcribing';
  $('talk').disabled=inactive||!voiceReady||voice.state==='transcribing';
  $('submit-case').disabled=inactive||!voiceReady||voice.state==='transcribing';
  $('pause').textContent=state.paused?'Resume':'Pause';
}
function renderContext(){
  if(!started)return;
  const near=nearestInteraction(state),door=nearestDoor(state);effectiveRole();$('speaker-title').textContent=titles[role];
  const key=[near?.id,door?.id,door?state.doors[door.id]>.5:false,state.paused,state.phase,role].join(':');
  if(key===contextKey)return;contextKey=key;$('context-actions').replaceChildren();
  if(state.paused||state.phase==='ending')return;
  const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;$('context-actions').append(b);};
  if(near&&['claire','elena'].includes(near.id)&&passingStarted)button('Repeat your conversation',()=>void playPassing(true));
}
function renderSuggestions(){
  const who=effectiveRole(),key=who+':'+[...collected].join(',');if(key===suggestionKey)return;suggestionKey=key;
  $('suggestions').replaceChildren();
  for(const [label,id]of questionOptions[who]||[]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>void followup(id);$('suggestions').append(b);}
}
async function dynamicReply(text,who){
  if(!$('spoken-replies').checked||!text||state.paused||state.phase==='ending')return;
  ttsController?.abort();const controller=new AbortController();ttsController=controller;const epoch=requestEpoch,run=runNumber,spokenEpoch=speechEpoch;
  foreground=true;
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const response=await fetch('/api/hotel/speak',{method:'POST',headers:{'Content-Type':'application/json','X-Voice-Token':voice.status.csrfToken},signal:controller.signal,body:JSON.stringify({text,role:who})});
    if(!response.ok)throw new Error('Spoken reply is unavailable; the text is shown above.');
    const bytes=await response.arrayBuffer();if(controller.signal.aborted||epoch!==requestEpoch||run!==runNumber||state.paused)return;
    await audio.playBytes(bytes,{sourceId:who==='guide'?undefined:who,kind:'speech',group:'guide'});
  }catch(error){if(!controller.signal.aborted)notice(error.message,true);}
  finally{clearTimeout(timer);if(ttsController===controller)ttsController=null;if(spokenEpoch===speechEpoch&&run===runNumber)foreground=false;}
}
async function receiveReply(result){
  if(!started||state.paused||state.phase==='ending')return;
  stopAssistance();
  if(typeof result.reply!=='string'||!Array.isArray(result.actions))return notice('The reply was incomplete. Please try again.',true);
  log('You',result.text,'user');remember('user',result.text);
  const who=effectiveRole();if(result.role!==who)return notice('You moved away before the reply arrived. Please ask again.');
  log(who==='guide'?'Gemini':who,result.reply);remember('assistant',result.reply);notice('');
  if(result.verdict==='correct'){
    if(recordingHeard&&Object.values(initial).every(id=>collected.has(id)))return finish(false,result.reply);
    return notice('Listen to all three initial statements and the complete recording first.',true);
  }
  if(result.verdict==='incorrect'||result.verdict==='incomplete')notice(result.verdict==='incorrect'?'That explanation does not yet fit the evidence. You can keep investigating.':'Your explanation is not complete yet. Keep comparing the evidence.',true);
  if(result.clipId&&data.speech[result.clipId]){stopSpeech();await playClip(result.clipId,{sourceId:who,collect:true});}
  else void dynamicReply(result.speechText||result.reply,who);
  const epoch=requestEpoch;
  for(const action of result.actions){
    if(epoch!==requestEpoch||state.paused||state.phase==='ending')break;
    if(action.type==='move'&&Number.isFinite(action.amount)&&Math.abs(action.amount)<=1)queueMove(state,action.amount);
    else if(action.type==='turn'&&Number.isFinite(action.amount)&&Math.abs(action.amount)<=180){let remaining=action.amount;while(Math.abs(remaining)>.01){const part=Math.sign(remaining)*Math.min(90,Math.abs(remaining));queueTurn(state,part);remaining-=part;}}
    else if(action.type==='door'){const d=nearestDoor(state);if(d)setDoor(state,d.id,action.state==='open');else notice('No door is within reach.');}
    else if(action.type==='interact')interact();
    else if(action.type==='stop')cancelMotion(state);
    await until(()=>!state.motion&&!state.motionQueue?.length,epoch);
  }
}
async function sendMessage(submit=false){
  if(voice.state==='transcribing')return;
  const text=$('message').value.trim();if(!text)return notice(submit?'Type or say your explanation first.':'Ask your companion a question.');
  if(!voiceReady)return notice('Gemini is unavailable. Recorded conversations and exploration still work.',true);
  if(submit)selectRole('guide');stopSpeech();cancelMotion(state);
  pendingSubmission=submit;try{const sent=await voice.sendText(text);if(sent)$('message').value='';}finally{pendingSubmission=false;}
}
function finish(revealed=false,reply=''){
  if(state.phase==='ending')return;
  stopSpeech();cancelMotion(state);state.phase='ending';audio.update(state);
  $('ending-title').innerHTML='Honest ears.<br>Different stories.';
  $('chat').hidden=true;$('ending').hidden=false;$('ending-status').textContent=revealed?'CASE REVIEW':'CASE EXPLAINED';
  $('ending-text').textContent=reply||'The second voice was an animal vocalization, consistent with the ape in this case, rather than another language. The witnesses honestly described an unfamiliar sound, then attached different language labels to it. Their impressions were not translations. Jake’s death was known from the beginning; the testimony alone does not establish its cause.';
  const endingRun=runNumber;
  void audio.play('ending',{kind:'effect',group:'ending'}).then(()=>{if(endingRun===runNumber&&state.phase==='ending')audio.stop();});
  notice(revealed?'The explanation is now available.':'Case explained.');renderControls();renderContext();
}
function until(predicate,epoch=requestEpoch){return new Promise(resolve=>{const check=()=>{if(predicate()||epoch!==requestEpoch||!started||state.paused)return resolve();requestAnimationFrame(check);};check();});}
function pause(){
  if(!started||state.phase==='ending')return;
  stopAssistance();
  state.paused=!state.paused;routeEpoch++;routeBusy=false;cancelRequest();
  if(state.paused){audio.pause();notice('Paused.');}else{audio.resume(state);notice('');}
  renderControls();renderContext();
}
async function begin(){
  if(starting)return;starting=true;$('start').disabled=true;$('load-status').textContent='Preparing the hotel…';
  try{
    if(!data){const response=await fetch('/hotel/data.json');if(!response.ok)throw new Error('Hotel assets could not be loaded.');data=await response.json();}
    await audio.init(data.catalog);audio.setVolume(Number($('volume').value));await audio.start(state);started=true;
    $('intro').hidden=true;$('playfield').hidden=false;$('chat').hidden=false;$('debug').hidden=!debug;
    log('Gemini','I’m here. Listen to the hotel and tell me what you notice.');notice('You are at the entrance.');renderControls();
  }catch(error){$('load-status').textContent=error.message;$('start').disabled=false;}
  finally{starting=false;}
}
async function restart(){
  runNumber++;routeEpoch++;stopSpeech();audio.stop();state=createState();started=false;role='guide';collected=new Set();notes=new Map();history=[];recordingHeard=false;
  foreground=false;passingStarted=false;passingComplete=false;passingMotion=null;welcomed=false;investigationSeconds=0;hintSent=false;revealSent=false;contextKey='';suggestionKey='';routeBusy=false;
  searchAttempts=0;navigationHint.reset();trailMap.reset();
  $('chat-log').replaceChildren();$('ending').hidden=true;$('notes').hidden=true;$('settings').hidden=true;$('message').value='';$('notes-toggle').setAttribute('aria-expanded','false');$('settings-toggle').setAttribute('aria-expanded','false');renderNotes();$('note-count').textContent='0';await begin();
}
function handleEvents(events){
  for(const event of events){
    if(event.type==='footstep'&&event.stairTo!==1)void audio.play('step-'+event.material,{position:event.position,kind:'effect',group:'steps'});
    if(event.type==='door-near'){void audio.play('door-cue',{position:event.position,kind:'effect',group:'cues'});notice('A doorway is within reach.');}
    if(event.type==='door'){void audio.play((event.id==='entrance'?'entrance-':'door-')+(event.open?'open':'close'),{position:event.position,kind:'effect',group:'doors'});notice(event.open?'The door opens.':'The door closes.');}
    if(event.type==='collision'){stopAssistance();notice('A wall or closed door is in front of you.');}
    if(event.type==='stairs-start'){cancelRequest();notice(event.to===1?'Climbing the stairs…':'Walking downstairs…');if(event.to===1){audio.stopGroup('steps');audio.stopGroup('stairs');void audio.play('stairs-up',{kind:'effect',group:'stairs',local:true});}}
    if(event.type==='stairs-end'){if(event.floor===1&&state.phase==='testimony')state.phase='investigation';notice(event.floor===1?'You reach the upstairs landing.':'You return to the lounge.');}
    if(event.type==='region'&&event.region==='lobby'&&!welcomed){welcomed=true;log('Martin','Good afternoon, Detective. We’ve been expecting you.');if(!foreground)void playClip('DLG-01-EN-R4',{sourceId:'martin'});}
  }
}
function frame(now){
  const dt=frameTime==null?0:Math.min(.05,(now-frameTime)/1000);frameTime=now;
  if(started&&!state.paused&&state.phase!=='ending'){
    handleEvents(updateWorld(state,dt));
    if(passingMotion){passingMotion.elapsed+=dt;const t=Math.min(1,passingMotion.elapsed/19),smooth=t*t*(3-2*t);
      for(const [id,endX] of [['claire',14],['elena',16.4]]){const start=passingMotion[id==='claire'?'startClaire':'startElena'];state.sources[id]={x:start.x+(endX-start.x)*smooth,y:start.y+(6.6-start.y)*smooth,floor:0};}
      if(t===1)passingMotion=null;
    }
    if(!passingStarted&&!foreground&&regionAt(state.player)==='lounge'&&!state.stairs)void playPassing();
    if(recordingHeard){investigationSeconds+=dt;
      if(investigationSeconds>=180&&!hintSent&&!foreground){hintSent=true;log('Gemini','Recall the passing conversation about Jake’s work. Then ask which words the witnesses could actually recognize.');}
      if(investigationSeconds>=360&&!revealSent&&!foreground){revealSent=true;finish(true);}
    }
  }
  if(started){updateAssistance(dt);audio.update(state);renderContext();renderSuggestions();renderWorldHud();if(now-lastTrailFrame>=50){trailMap.update(state);lastTrailFrame=now;}updateNavigationHint(dt);}
  if(debug&&now-lastDebug>160){lastDebug=now;renderDebug();}
  requestAnimationFrame(frame);
}
function renderDebug(){
  const canvas=$('debug-map'),ctx=canvas.getContext('2d'),s=29,X=x=>60+x*s,Y=y=>440-y*s;ctx.clearRect(0,0,720,550);ctx.fillStyle='#11191c';ctx.fillRect(0,0,720,550);
  ctx.strokeStyle='#bdc8c4';ctx.lineWidth=2;for(const w of WALLS.filter(w=>w.floor===state.player.floor)){ctx.beginPath();ctx.moveTo(X(w.x1),Y(w.y1));ctx.lineTo(X(w.x2),Y(w.y2));ctx.stroke();}
  for(const id of Object.keys(state.doors)){const p=doorPosition(id);if(!p||p.floor!==state.player.floor)continue;ctx.fillStyle=state.doors[id]>.8?'#76cba6':'#d58b78';ctx.fillRect(X(p.x)-7,Y(p.y)-7,14,14);}
  ctx.font='18px system-ui';for(const [id,p]of Object.entries(state.sources)){if(p.floor!==state.player.floor||id.endsWith('-bed'))continue;ctx.fillStyle='#c4c8bd';ctx.beginPath();ctx.arc(X(p.x),Y(p.y),5,0,Math.PI*2);ctx.fill();ctx.fillText(id,X(p.x)+8,Y(p.y)-7);}
  const p=state.player;ctx.fillStyle='#78cde4';ctx.beginPath();ctx.arc(X(p.x),Y(p.y),7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#78cde4';ctx.beginPath();ctx.moveTo(X(p.x),Y(p.y));ctx.lineTo(X(p.x)+Math.sin(p.heading)*20,Y(p.y)-Math.cos(p.heading)*20);ctx.stroke();
  ctx.fillStyle='#d5e5e3';ctx.fillText('Floor '+(p.floor+1)+' · '+regionAt(p),25,28);
  $('qa-state').textContent=JSON.stringify({player:p,doors:state.doors,stairs:state.stairs,phase:state.phase,paused:state.paused,role,collected:[...collected],recordingHeard,foreground,routeBusy,searchAttempts,hint:{stalled:navigationHint.stalled,remaining:navigationHint.remaining,lostSeconds:navigationHint.lostSeconds},assistance:assistance?{goalId:assistance.goalId,travelled:assistance.travelled,elapsed:assistance.elapsed}:null,trail:trailMap.getStats?.()||null,audio:audio.getStats()},null,1);
}
async function navigate(points){
  const run=runNumber,route=routeEpoch;
  const valid=()=>run===runNumber&&route===routeEpoch&&!state.paused&&state.phase!=='ending';
  for(const [x,y]of points){
    const startFloor=state.player.floor;
    for(let steps=0;steps<90;steps++){
      if(!valid())return false;
      if(state.stairs)await until(()=>!state.stairs);
      if(!valid())return false;
      if(state.player.floor!==startFloor)break;
      const dx=x-state.player.x,dy=y-state.player.y,d=Math.hypot(dx,dy);if(d<.12)break;
      const target=Math.atan2(dx,dy),delta=Math.atan2(Math.sin(target-state.player.heading),Math.cos(target-state.player.heading))*180/Math.PI;
      if(Math.abs(delta)>1){queueTurn(state,delta);await until(()=>!state.motion&&!state.motionQueue?.length);}
      if(!valid())return false;
      queueMove(state,Math.min(.5,d));await until(()=>!state.motion&&!state.motionQueue?.length);
      if(!valid())return false;
      if(steps===89)throw new Error('The route could not reach the next point.');
    }
  }return true;
}
async function qaWalk(returning=false){
  if(!debug||routeBusy||!started||state.paused||state.phase==='ending'||(returning&&state.player.floor!==1))return;
  routeBusy=true;const run=runNumber,route=++routeEpoch;
  const valid=()=>run===runNumber&&route===routeEpoch&&!state.paused&&state.phase!=='ending';
  const step=async promise=>{const result=await promise;if(!valid()||result===false)throw new Error('Route cancelled.');};
  const walk=points=>step(navigate(points));
  const wait=predicate=>step(until(()=>predicate()||!valid()));
  try{
    if(returning){
      await walk([[3,7]]);setDoor(state,'recording',true);await wait(()=>state.doors.recording>.98);
      await walk([[3,9.5],[13.5,10],[14.3,10]]);await wait(()=>!state.stairs);return;
    }
    await walk([[5,-.8]]);setDoor(state,'entrance',true);await wait(()=>state.doors.entrance>.98);
    await walk([[5,1],[5,8],[4,8]]);await step(talkTo('martin'));
    await walk([[9,4.6]]);setDoor(state,'lounge',true);await wait(()=>state.doors.lounge>.98);
    await walk([[11.5,4.6]]);await wait(()=>!foreground&&passingComplete);
    await walk([[state.sources.claire.x-.5,state.sources.claire.y]]);await step(talkTo('claire'));
    await walk([[state.sources.elena.x-.5,state.sources.elena.y]]);await step(talkTo('elena'));
    await walk([[16,7.4],[16,8.3]]);await wait(()=>!state.stairs);
    await walk([[12.4,9.5]]);await step(talkTo('cleaner'));
    await walk([[3,9]]);setDoor(state,'recording',true);await wait(()=>state.doors.recording>.98);
    await walk([[3,6.9]]);setDoor(state,'recording',false);await walk([[3,4.2]]);await step(playIncident());
  }catch(error){if(valid())notice(error.message,true);}
  finally{if(run===runNumber&&route===routeEpoch)routeBusy=false;}
}

$('start').onclick=()=>void begin();$('restart').onclick=$('play-again').onclick=()=>void restart();$('pause').onclick=pause;$('stop-audio').onclick=stopSpeech;
$('notes-toggle').onclick=()=>{stopAssistance();const open=$('notes').hidden;$('notes').hidden=!open;$('settings').hidden=true;$('notes-toggle').setAttribute('aria-expanded',String(open));$('settings-toggle').setAttribute('aria-expanded','false');};
$('settings-toggle').onclick=()=>{stopAssistance();const open=$('settings').hidden;$('settings').hidden=!open;$('notes').hidden=true;$('settings-toggle').setAttribute('aria-expanded',String(open));$('notes-toggle').setAttribute('aria-expanded','false');};
$('assist-stop').onclick=()=>stopAssistance('You are in control.');
$('message').addEventListener('focus',()=>stopAssistance());
$('volume').oninput=()=>audio.setVolume(Number($('volume').value));$('spoken-replies').onchange=()=>{if(!$('spoken-replies').checked){ttsController?.abort();audio.stopGroup('guide');}};
$('guide').onclick=$('back-guide').onclick=()=>{selectRole('guide');notice('Talk through the evidence with Gemini.');};
$('chat-form').onsubmit=e=>{e.preventDefault();void sendMessage();};$('submit-case').onclick=()=>void sendMessage(true);
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage();}});
function startCapture(){stopAssistance();if(silent)return notice('Microphone disabled in this silent test session.');stopSpeech();cancelMotion(state);void voice.start();}
$('talk').addEventListener('pointerdown',e=>{e.preventDefault();$('talk').setPointerCapture(e.pointerId);startCapture();});$('talk').addEventListener('pointerup',()=>void voice.stop());$('talk').addEventListener('pointercancel',()=>voice.cancel());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){stopAssistance('You are in control.');$('message').blur();cancelRequest();cancelMotion(state);return;}
  if(e.metaKey||e.ctrlKey||e.altKey||e.target.closest('input,textarea,select'))return;
  const k=e.key.toLowerCase(),action={arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right'}[k];
  if(action){e.preventDefault();if(assistance)stopAssistance();if(!state.motion&&!state.motionQueue?.length)move(action);}
  else if(k==='e'&&!e.repeat){e.preventDefault();interact();}else if(k==='f'&&!e.repeat){e.preventDefault();useDoor();}
  else if(k==='p'&&!e.repeat){e.preventDefault();pause();}else if(k==='v'&&!e.repeat){e.preventDefault();startCapture();}
});
document.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='v')void voice.stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started){if(state.phase==='ending')audio.stop();else if(!state.paused)pause();}});
window.addEventListener('pagehide',()=>{voice.destroy();audio.stop();});
$('qa-route').onclick=()=>void qaWalk();$('qa-return').onclick=()=>void qaWalk(true);
$('qa-assist').onclick=()=>{if(debug)startAssistance(navigationGoal(state,collected,recordingHeard));};
voice.init().then(status=>{voiceReady=status.configured;$('connection').textContent=voiceReady?'Gemini connected':'Gemini unavailable';renderControls();}).catch(()=>{$('connection').textContent='Gemini unavailable';});
$('start').disabled=false;$('load-status').textContent='Sound begins only after you enter.';
requestAnimationFrame(frame);
