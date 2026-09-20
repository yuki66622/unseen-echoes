import {PlayPanel} from '../play-panel.mjs';
import {NavigationHUD} from '/navigation-hud.mjs';
import {SceneAudio} from './scene-audio.mjs';
import {RoomConnection} from './network.bundle.mjs';
import {sampleMotion,motionDuration} from './game-module/src/physics.mjs';
import {sampleMotion as sampleLocalMotion} from './tutorial-physics.mjs';
import {isNearDoor as isNearChaseDoor} from './game-module/src/geometry.mjs';
import {DOOR,isNearDoor,occupiesDoor,hasLineOfSight,distance} from '../room-layout.mjs?v=rooms-v3';
import {createStory,inspectStory,storyView,accuseStory,STORY_INTRO,STORY_SOURCES} from './solo-story.mjs';
import {localizeMessage,roleLabel,outcomeLabel} from './i18n.mjs';
import {LobbyFlow} from './lobby-flow.mjs';
import {ConnectionCheck} from './connection-check.mjs';
import {fetchWithTimeout} from './request.mjs';

const $=id=>document.getElementById(id), show=(id,yes)=>$(id).hidden=!yes;
const sessionGet=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
const sessionSet=(key,value)=>{try{sessionStorage.setItem(key,value);}catch{}};
const sessionRemove=key=>{try{sessionStorage.removeItem(key);}catch{}};
const params=new URLSearchParams(location.search),silent=params.get('silent')==='1',qa=silent&&params.get('qa')==='1';
const audio=new SceneAudio({silent});
const navigationHud=new NavigationHUD({map:true,label:'追逐'});
const SOURCES=[{id:'a',soundId:'forest',x:1.5,y:4.8},{id:'b',soundId:'rain',x:6.5,y:5.5},{id:'c',soundId:'fire',x:2,y:7}];
let phase='opening',local=null,motion=null,story=null,room=null,roomState=null,config=null;
let pose={x:2,y:1,heading:0},pending=null,remoteMotion=null,remoteReceived=0,seq=0,roundId='';
let paused=false,starting=false,chatBusy=false,history=[],epoch=0,chatAbort=null,doorArmed=true;
let remoteSamples=new Map(),lastRender='',rttSamples=[],statusMessage='',frameCount=0;
let voiceWarning='';
let soundOperation=0,enteringStory=false;
let networkState={state:'connecting'};
new ConnectionCheck({
  getConfig:()=>fetchWithTimeout('/api/detective/config',{},8000,response=>{if(!response.ok)throw Error();return response.json();}),
  getToken:()=>room?.token,
  getNetworkState:()=>networkState,
});
// Dot Matrix Origin Wave, adapted for this game's waiting UI (no React runtime).
// Upstream provenance and custom product-use license: provenance/THIRD_PARTY_NOTICES.md.
const waitIndicator=$('partner-wait'),waitLabel=$('partner-wait-label');
for(let row=0;row<5;row++)for(let col=0;col<5;col++){
  const dot=document.createElement('span');
  const ring=Math.min(6,Math.abs(row-1)+Math.abs(col-1));
  dot.style.setProperty('--wave-delay',`${ring*.16*1500/.65}ms`);
  dot.style.setProperty('--wave-still',String(.2+(1-ring/6)*.75));
  waitIndicator.querySelector('.origin-wave').append(dot);
}
function renderPartnerWait(){
  let message='',target=null;
  if(phase==='lobby'){
    target=$('lobby');
    if(room&&!room.ready)message='正在连接游戏……';
    else if(roomState){
      const partner=roomState.members.find(m=>m.identity!==room?.identity);
      const mine=roomState.members.find(m=>m.identity===room?.identity);
      if(!partner)message='等待朋友加入房间……';
      else if(!partner.online)message='等待朋友重新连接……';
      else if(mine?.ready&&!partner.ready)message='你已准备，等待朋友准备……';
      else if(mine?.ready&&partner.ready)message='两人已准备，正在进入追逐……';
    }
  }else if(phase==='chase'){
    target=$('narrative');
    if(!room?.ready)message='正在重新连接游戏……';
    else if(roomState?.game?.paused)message='等待朋友重新连接……';
  }else if(phase==='chase-result'&&roomState){
    target=$('result');
    const mine=roomState.members.find(m=>m.identity===room?.identity);
    const partner=roomState.members.find(m=>m.identity!==room?.identity);
    if(mine?.restartVote&&partner){
      if(!partner.online)message='等待朋友重新连接……';
      else if(!partner.restartVote)message='等待朋友同意重新选择角色……';
    }
  }
  if(target&&waitIndicator.parentElement!==target)target.append(waitIndicator);
  if(waitLabel.textContent!==message)waitLabel.textContent=message;
  waitIndicator.hidden=!message;
}
const say=text=>{statusMessage=localizeMessage(text);$('status').textContent=statusMessage;};
const lobby=new LobbyFlow({
  create:name=>{const data=crypto.getRandomValues(new Uint32Array(1))[0];return room.call('createRoom',{code:data.toString(36).toUpperCase().padStart(6,'0').slice(-6),mode:'chase',name});},
  join:(code,name)=>room.call('joinRoom',{code,name}),
  role:role=>room.call('selectRole',{role}),
  ready:async ready=>{if(ready)await audio.prepareChase();return room.call('setReady',{ready});},
  leave:()=>room.call('leaveRoom',{}),
  retry:()=>void connectLobby(true),
});
lobby.setInvitation(params.get('room'));
const copyPose=p=>({x:p.x,y:p.y,heading:p.heading});
const active=()=>['tutorial','chase','story'].includes(phase);
const localSnapshot=()=>({self:{...pose,moving:Boolean(motion?.forward)},sources:local?.sources||SOURCES,doorOpen:local?.doorOpen||false,audiblePlayers:[]});
function snapshotForAudio(){
  if(phase!=='chase')return localSnapshot();
  if(!roomState?.game)return null;
  const g=roomState.game,now=performance.now();
  return {...g,self:{...pose,moving:Boolean((pending||remoteMotion)?.forward)},audiblePlayers:(g.audiblePlayers||[]).map(p=>{
    const sample=remoteSamples.get(p.id);if(!sample)return p;
    const amount=Math.max(0,Math.min(1,(now-sample.at)/50));
    return {...p,x:sample.from.x+(p.x-sample.from.x)*amount,y:sample.from.y+(p.y-sample.from.y)*amount};
  })};
}
async function startSound(){
  if(document.hidden){
    stopSound();paused=true;show('sound-toggle',true);$('sound-toggle').textContent='恢复声音';
    say('对局已经开始。回到页面后点击“恢复声音”继续。');return;
  }
  if(starting)return;starting=true;const generation=epoch,operation=++soundOperation;
  try{
    const snapshot=snapshotForAudio();if(!snapshot)return;
    const started=await audio.start(snapshot);
    if(generation!==epoch||operation!==soundOperation||!started)return;
    paused=false;show('sound-toggle',true);$('sound-toggle').textContent='暂停声音';
  }catch(error){if(operation===soundOperation&&generation===epoch){say('声音暂时无法启动，请点击“恢复声音”重试。');paused=true;show('sound-toggle',true);$('sound-toggle').textContent='恢复声音';}}
  finally{if(operation===soundOperation)starting=false;}
}
function stopSound(){soundOperation++;starting=false;audio.pause();}
function resetLocal(kind){
  epoch++;motion=null;pending=null;remoteMotion=null;stopSound();paused=false;doorArmed=true;
  pose={x:2,y:1,heading:0};local={sources:kind==='story'?STORY_SOURCES:SOURCES,doorOpen:false};
}
function setPhase(next){
  phase=next;document.body.dataset.phase=phase;lastRender='';
  show('opening',phase==='opening');show('game',phase!=='opening');
  show('lobby',phase==='lobby');show('narrative',!['lobby','chase-result','story-result'].includes(phase));
  show('story-panel',phase==='story');
  show('result',phase.endsWith('-result'));show('begin',phase.endsWith('-ready'));
  show('skip-tutorial-active',['tutorial-ready','tutorial'].includes(phase));
  show('sound-toggle',active());show('skip-chase',phase==='lobby'||phase==='chase');show('show-rules',phase==='lobby'&&$('lobby').dataset.step!=='rules');
  $('chapter').textContent=phase.startsWith('tutorial')?'初次穿行':phase==='lobby'||phase.startsWith('chase')?'第一关 · 追逐':'第二关 · 沉默的钟声';
  $('role-label').textContent='';
  if(phase==='tutorial-ready'){
    $('title').textContent='找到雨声。';$('objective').textContent='三种声音交叠。找到门后的雨声。';$('begin').textContent='进入声场';
  }else if(phase==='tutorial'){
    $('title').textContent='聆听。转身。循声而行。';$('objective').textContent='循着雨声靠近，再按 E 查看。鸟鸣与火声能帮助你辨认方位。';
  }else if(phase==='story-ready'){
    $('title').textContent='沉默的钟声';$('objective').textContent=STORY_INTRO;$('begin').textContent='开始调查';
  }else if(phase==='story'){
    $('title').textContent='沉默的钟声';$('role-label').textContent='属于你一个人的调查';renderStory();
  }
  if(phase!=='opening')window.scrollTo({top:0});
  renderPartnerWait();
}
function finishTutorial(){
  stopSound();motion=null;setPhase('tutorial-complete');sessionSet('unseen-tutorial-complete','1');say('你找到了雨声，初次穿行完成。');
  $('title').textContent='你已经学会聆听。';$('objective').textContent='下一扇门后，另一位玩家正等着你。';
  show('begin',true);$('begin').textContent='进入第一关';
}
let configLoading=null;
async function enterLobby(options={}){
  stopSound();motion=null;pending=null;setPhase('lobby');sessionSet('unseen-checkpoint','lobby');say('');
  lobby.begin(options);await connectLobby();
}
async function connectLobby(retry=false){
  lobby.setConnection('正在连接游戏……',{state:'connecting'});
  try{
    if(!config){
      if(!configLoading)configLoading=fetchWithTimeout('/api/detective/config',{},8000,r=>{if(!r.ok)throw Error('游戏入口暂时无法连接，请稍后重试。');return r.json();}).finally(()=>{configLoading=null;});
      config=await configLoading;
      lobby.setInviteBase(config.hosting==='cloud'?location.origin:null);
      $('client-build').textContent=`联机版本 ${config.clientBuild||'旧版本'}`;
    }
    if(!room){
      room=new RoomConnection(config,onRoom,(message,details={})=>{
        networkState=details;
        const translated=localizeMessage(message);lobby.setConnection(translated,details);$('network-indicator').textContent=translated;
        if(phase==='chase'&&!room?.ready){pending=null;remoteMotion=null;stopSound();say(message);}renderPartnerWait();
      });room.connect();
    }else if(retry)room.reconnect();
    else if(room.ready){lobby.setConnection('已连接',{state:'connected'});renderLobby();}
  }catch(error){lobby.setConnection('无法连接游戏入口。',{state:'error'});lobby.error(localizeMessage(error.message,'游戏入口暂时无法连接，请稍后重试。'));}
}
function renderLobby(){lobby.updateRoom(roomState,room?.identity);}
function onRoom(next){
  if(!next&&!room?.ready&&phase==='lobby'){renderPartnerWait();return;}
  const previous=roomState;roomState=next;
  if(next?.phase==='lobby'&&['chase','chase-result'].includes(phase)){
    epoch++;stopSound();motion=null;pending=null;remoteMotion=null;remoteSamples.clear();
    roundId=null;seq=0;paused=false;setPhase('lobby');sessionSet('unseen-checkpoint','lobby');say('');
  }
  renderPartnerWait();
  if(phase==='lobby')renderLobby();
  if(!next){
    if(phase==='chase'&&!room?.ready){pending=null;remoteMotion=null;stopSound();return;}
    return;
  }
  const g=next.game;
  $('network-indicator').textContent=`${next.members.filter(m=>m.online).length} / 2 人在线`;
  if(!g)return;
  if(next.phase==='running'&&['lobby','chase','chase-result'].includes(phase)){
    const entering=phase!=='chase'||roundId!==g.roundId;
    if(entering){
      epoch++;roundId=g.roundId;seq=g.lastProcessedInputSeq||0;pose=copyPose(g.self);pending=null;remoteMotion=null;remoteSamples.clear();paused=false;setPhase('chase');void startSound();
    }
    else if(!previous&&!paused)void startSound();
    if(!pending||g.lastProcessedInputSeq>=pending.seq){
      const sameMotion=pending&&g.motion?.seq===pending.seq
        &&g.motion.forward===pending.forward&&g.motion.turn===pending.turn
        &&g.motion.durationMs===pending.durationMs;
      if(sameMotion){
        // Confirmation must not restart a motion already predicted on this device.
        // Keep the input clock, but reconcile its starting position to the server.
        pending.origin=copyPose(g.motion.origin);remoteMotion=null;
      }else{
        pending=null;remoteMotion=g.motion;remoteReceived=performance.now();
        if(!g.motion)pose=copyPose(g.self);
      }
    }
    const nextIds=new Set((g.audiblePlayers||[]).map(p=>p.id));
    for(const id of remoteSamples.keys())if(!nextIds.has(id))remoteSamples.delete(id);
    for(const p of g.audiblePlayers||[])remoteSamples.set(p.id,{from:previous?.game?.audiblePlayers?.find(x=>x.id===p.id)||p,at:performance.now()});
    $('title').textContent=g.role==='hunter'?(g.headstartSeconds>0?`追捕将在 ${Math.ceil(g.headstartSeconds)} 秒后开始。`:'循着心跳声，找到求生者。'):'找到老式电机，设法逃脱。';
    if(g.role==='hunter'&&previous?.game?.headstartSeconds>0&&g.headstartSeconds===0)say('追捕开始。');
    $('role-label').textContent=`${roleLabel(g.role)} · 剩余 ${Math.ceil(g.remainingSeconds)} 秒${g.headstartSeconds>0?` · 求生者先行 ${Math.ceil(g.headstartSeconds)} 秒`:''}`;
    $('objective').textContent=localizeMessage(g.objective,'循着声音，完成你的目标。');
    if(g.notice&&g.notice!==previous?.game?.notice)say(g.notice);
    if(g.paused){pending=null;remoteMotion=null;stopSound();say(g.notice||'等待另一位玩家重新连接。');}
    else if(previous?.game?.paused&&!paused)void startSound();
  }
  if(next.phase==='finished'&&['chase','lobby','chase-result'].includes(phase)){
    const newResult=phase!=='chase-result'||previous?.game?.roundId!==g.roundId;
    if(newResult){
      const playVictory=phase==='chase'&&!paused&&!document.hidden;
      motion=null;pending=null;remoteMotion=null;soundOperation++;starting=false;setPhase('chase-result');
      void audio.finish(g,{playVictory}).catch(()=>say('结算音效未能加载。'));
    }
    $('result-title').textContent=g.winner===g.role?'你赢得了这场追逐。':g.winner?'追逐结束了。':'连接中断，本局结束。';
    $('result-body').textContent=outcomeLabel(g.outcome);
    show('next-level',true);show('rematch',next.members.length===2);show('return-title',false);
    $('rematch').textContent=`重新选择角色${g.restartVotes?`（${g.restartVotes}/2 人同意）`:''}`;
  }
}
function currentDoor(){return phase==='chase'?Boolean(roomState?.game?.doorOpen):Boolean(local?.doorOpen);}
function canAct(){return active()&&!starting&&!paused&&(phase!=='chase'||(room?.ready&&!roomState?.game?.paused));}
async function networkInput(kind,value=''){
  if(!canAct())return;
  const g=roomState.game,number=++seq,at=performance.now(),generation=epoch;
  if(['move','turn'].includes(kind)&&!(g.role==='hunter'&&g.headstartSeconds>0)){
    const forward=kind==='move'?(value==='forward'?.5:-.5):0,turn=kind==='turn'?(value==='right'?Math.PI/6:-Math.PI/6):0;
    pending={seq:number,origin:copyPose(pose),forward,turn,durationMs:motionDuration(forward,turn),startAt:at};remoteMotion=null;
  }else if(kind==='stop'){
    // Keep the sequence barrier: older movement snapshots may still be in flight.
    pending={seq:number,origin:copyPose(pose),forward:0,turn:0,durationMs:0,startAt:at};remoteMotion=null;
  }
  try{await room.call('input',{roundId:g.roundId,seq:number,kind,value});rttSamples.push(performance.now()-at);if(rttSamples.length>100)rttSamples.shift();}
  catch(error){
    if(generation!==epoch||phase!=='chase'||roundId!==g.roundId)return;
    // An older failed request must not undo a more recent input or another level.
    if(number===seq&&['move','turn','stop'].includes(kind)){pending=null;remoteMotion=null;if(roomState?.game)pose=copyPose(roomState.game.self);}
    say(error.message||String(error));
  }
}
function act(action){
  if(!canAct())return;
  if(phase==='chase'){
    if(action==='stop')return void networkInput('stop');
    return void networkInput(['left','right'].includes(action)?'turn':'move',action);
  }
  if(action==='stop'){motion=null;return say('已停下。');}
  const forward=action==='forward'?.5:action==='back'?-.5:0,turn=action==='right'?Math.PI/6:action==='left'?-Math.PI/6:0;
  motion={origin:copyPose(pose),forward,turn,durationMs:motionDuration(forward,turn),startAt:performance.now()};
  say(forward?'正在移动……':'正在转身……');
}
function useDoor(){
  if(!canAct())return;
  if(phase==='chase')return say('这里没有门。循着电机声音寻找出口。');
  motion=null;
  if(!isNearDoor(pose))return say('请先靠近门。');
  if(local.doorOpen&&occupiesDoor(pose))return say('请先离开门口，再关门。');
  local.doorOpen=!local.doorOpen;audio.playCue('door',DOOR.center);say(local.doorOpen?'门打开了。':'门关上了。');
}
function inspect(){
  if(!canAct())return;
  if(phase==='chase')return void networkInput('interact','inspect');
  motion=null;
  if(phase==='story'){
    const result=inspectStory(story,pose,local.doorOpen);say(result.message);renderStory();return;
  }
  const near=local.sources.find(p=>distance(pose,p)<=1.1&&hasLineOfSight(pose,p,local.doorOpen));
  if(!near)return say('再靠近声源一点，然后查看。');
  if(near.soundId==='rain')finishTutorial();
  else{audio.playCue('wrong');say('这不是雨声。继续聆听，你可以再试一次。');}
}
function renderStory(){
  const view=storyView(story);$('objective').textContent=view.objective;$('clue-count').textContent=`${view.clues.length} / 3`;
  $('clues').replaceChildren(...view.clues.map(c=>{const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=c.title;p.textContent=c.text;article.append(h,p);return article;}));
  $('accuse').disabled=view.clues.length<3;
}
async function enterStory(){
  if(enteringStory)return;
  enteringStory=true;stopSound();motion=null;pending=null;
  if(room?.ready)try{await room.call('leaveRoom',{});}catch{}
  room?.disconnect();room=null;roomState=null;
  sessionSet('unseen-checkpoint','hotel');navigateChapter('/hotel/');
}
function appendChat(speaker,text){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=`${speaker}: `;p.append(strong,document.createTextNode(text));$('chat-log').append(p);$('chat-log').scrollTop=$('chat-log').scrollHeight;}
async function chat(event){
  event.preventDefault();if(chatBusy||phase!=='story')return;
  const text=$('chat-text').value.trim();if(!text)return;
  const generation=epoch,earned=storyView(story).clues;chatBusy=true;$('chat-send').disabled=true;$('chat-send').textContent='Gemini 正在思考……';
  appendChat('你',text);$('chat-text').value='';chatAbort=new AbortController();
  const timeout=setTimeout(()=>chatAbort?.abort(),18000);
  try{
    if(!config)throw Error('对话服务暂时不可用，你仍可继续探索。');
    const response=await fetch('/api/detective/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Game-Token':config.csrf},body:JSON.stringify({text,history:history.slice(-8),clues:earned}),signal:chatAbort.signal});
    const data=await response.json();if(!response.ok)throw Error(data.error||'对话暂时未完成，请稍后重试。');
    if(generation!==epoch||phase!=='story')return;
    appendChat('Gemini',data.reply);history.push({role:'user',text},{role:'assistant',text:data.reply});history=history.slice(-8);
  }catch(error){if(generation===epoch&&phase==='story')appendChat('连接提示',error.name==='AbortError'?'回复超时了，你可以稍后重试，同时继续调查。':localizeMessage(error.message,'对话暂时未完成，你仍可继续探索。'));}
  finally{clearTimeout(timeout);if(generation===epoch){chatBusy=false;$('chat-send').disabled=false;$('chat-send').textContent='询问 Gemini';}}
}
const playPanel=new PlayPanel({chapter:'chase',readState:()=>audio.getEnvironmentVisualState()});
function frame(now){
  frameCount++;playPanel.update(phase==='chase');
  navigationHud.update({player:pose,active:phase==='chase',paused,roundKey:roundId,attemptsRemaining:roomState?.game?.attemptsRemaining});
  if(canAct()){
    let current=phase==='chase'?pending||remoteMotion:motion;
    if(current){
      const elapsed=phase==='chase'&&!pending?(current.elapsedMs+now-remoteReceived):now-current.startAt;
      const sample=(phase==='chase'?sampleMotion:sampleLocalMotion)(current,elapsed,currentDoor());pose=copyPose(sample.pose);
      if(sample.done||sample.blocked){
        if(phase!=='chase'){motion=null;say(sample.blocked?'前方被挡住了。':'已停下。');}
      }
    }
    const snapshot=snapshotForAudio();if(snapshot)audio.update(snapshot);
    const near=(phase==='chase'?isNearChaseDoor:isNearDoor)(pose);
    if(phase!=='chase'){
      if(near&&doorArmed){audio.playCue('door',DOOR.center);doorArmed=false;}
      if(distance(pose,DOOR.center)>DOOR.rearmRadius)doorArmed=true;
    }
  }
  requestAnimationFrame(frame);
}

document.querySelectorAll('[data-skip-tutorial]').forEach(button=>button.addEventListener('click',()=>{
  if(!['opening','tutorial-ready','tutorial'].includes(phase))return;
  void enterLobby({skipRules:true});
}));
$('begin').addEventListener('click',async()=>{
  if(phase==='tutorial-complete')return enterLobby().catch(e=>say(e.message));
  if(phase==='tutorial-ready'){setPhase('tutorial');say('慢慢转身，雨声在门后。');await startSound();}
  else if(phase==='story-ready'){setPhase('story');say('靠近鸟鸣、雨声和火声，分别查看，寻找三条证据。');await startSound();}
});
$('chat-text').addEventListener('invalid',()=>$('chat-text').setCustomValidity('请先输入想讨论的问题。'));
$('chat-text').addEventListener('input',()=>$('chat-text').setCustomValidity(''));
$('next-level').addEventListener('click',enterStory);
$('rematch').addEventListener('click',()=>room.call('restartRound',{}).catch(e=>$('result-body').textContent=localizeMessage(e.message)));
$('accuse-form').addEventListener('submit',e=>{
  e.preventDefault();if(phase!=='story')return;const answer=accuseStory(story,$('suspect').value);say(answer.message);renderStory();
  const view=storyView(story);if(view.outcome){epoch++;chatAbort?.abort();stopSound();motion=null;setPhase('story-result');$('result-title').textContent='你听见了沉默背后的真相。';$('result-body').textContent=answer.message;show('next-level',false);show('rematch',false);show('return-title',true);}
});
$('return-title').addEventListener('click',()=>{sessionRemove('unseen-checkpoint');location.reload();});$('chat-form').addEventListener('submit',chat);
$('skip-chase').addEventListener('click',()=>{stopSound();room?.disconnect();navigateChapter('/hotel/');});
$('sound-toggle').addEventListener('click',()=>{
  if(paused){void startSound();return;}
  if(phase==='chase')void networkInput('stop');else pending=null;
  motion=null;remoteMotion=null;stopSound();paused=true;$('sound-toggle').textContent='恢复声音';say(phase==='chase'?'你的操作和声音已暂停，对局仍在计时。':'声音和移动已暂停。');
});
$('settings-button').addEventListener('click',()=>show('settings',$('settings').hidden));
$('volume').addEventListener('input',()=>audio.setVolume(Number($('volume').value)/100));
function setColour(colour){
  const rgb=colour.match(/[0-9a-f]{2}/gi)?.map(part=>parseInt(part,16));if(!rgb||rgb.length!==3)return;
  const luminance=values=>values.map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  // Keep custom text readable on the black game surface (7:1 minimum contrast).
  while(luminance(rgb)<.3)for(let i=0;i<3;i++)rgb[i]=Math.min(255,rgb[i]+1);
  const readable='#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
  document.documentElement.style.setProperty('--ink',readable);$('text-colour').value=readable;
  try{localStorage.setItem('unseen-text-colour',readable);}catch{}
}
let saved='';try{saved=localStorage.getItem('unseen-text-colour')||'';}catch{}if(/^#[0-9a-f]{6}$/i.test(saved))setColour(saved);
$('text-colour').addEventListener('input',e=>setColour(e.target.value));$('reset-colour').addEventListener('click',()=>setColour('#b7c7dc'));
document.addEventListener('keydown',event=>{
  if(event.target.closest('#language-switch'))return;
  if(event.repeat||event.metaKey||event.ctrlKey||event.altKey||['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
  const action={arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right',' ':'stop'}[event.key.toLowerCase()];
  if(action){event.preventDefault();act(action);}else if(event.key.toLowerCase()==='f'){event.preventDefault();useDoor();}else if(event.key.toLowerCase()==='e'){event.preventDefault();inspect();}else if(event.key.toLowerCase()==='p'&&active()){event.preventDefault();$('sound-toggle').click();}
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)return;
  if(phase==='chase-result'){stopSound();return;}
  if(!active())return;
  if(phase==='chase'&&room?.ready)void networkInput('stop');else pending=null;
  motion=null;remoteMotion=null;stopSound();paused=true;$('sound-toggle').textContent='恢复声音';say('页面已切到后台。点击“恢复声音”继续；双人对局可能仍在进行。');
});
window.addEventListener('pagehide',()=>{stopSound();chatAbort?.abort();room?.disconnect();});
function resumeConnection(){
  if(document.hidden||navigator.onLine===false)return;
  if(room)room.resume();else if(phase==='lobby')void connectLobby();
}
window.addEventListener('pageshow',resumeConnection);
window.addEventListener('online',resumeConnection);
window.addEventListener('focus',resumeConnection);
document.addEventListener('visibilitychange',resumeConnection);
window.addEventListener('offline',()=>room?.goOffline());
if(silent)$('silent-note').textContent='静默测试';
if(qa)window.__unseen={
  state:()=>({phase,pose:copyPose(pose),local,story:story&&storyView(story),room:roomState,identity:room?.identity,audio:audio.getStats(),visual:audio.getEnvironmentVisualState(),frameCount,rttSamples:[...rttSamples],paused}),
  tutorial:()=>{resetLocal('tutorial');setPhase('tutorial-ready');},
  lobby:enterLobby,act,inspect,useDoor,
  localPose:p=>{if(!['tutorial','story'].includes(phase))throw Error('测试位置只能用于本地关卡。');motion=null;pose=copyPose(p);},
  input:networkInput,reconnect:()=>room?.reconnect(),
};
requestAnimationFrame(frame);
function navigateChapter(path){const url=new URL(path,location.origin);if(silent)url.searchParams.set('silent','1');location.assign(url);}
const requestedChapter=params.get('chapter');
if(requestedChapter==='title')sessionRemove('unseen-checkpoint');
const checkpoint=requestedChapter==='lobby'?'lobby':sessionGet('unseen-checkpoint');
if(checkpoint==='lobby'||/^[A-Za-z0-9]{6}$/.test(params.get('room')||''))void enterLobby({skipRules:true});
else if(checkpoint==='story'||checkpoint==='hotel')void enterStory();
else if(checkpoint==='tutorial')navigateChapter('/tutorial/');
