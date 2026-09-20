import {NavigationHUD} from '/navigation-hud.mjs';
import {SoundHuntAudio} from './sound-engine.mjs?v=environment-orb-v1';
import {SOUNDS,TARGET_SOUND} from './sound-catalog.mjs?v=rooms-v3';
import {createGame,nearbySource,confirmSource,toggleDoor} from './world.mjs?v=rooms-v3';
import {SmoothMovement} from './movement.mjs?v=walk-v1';
import {DOOR,WALLS,isNearDoor,insideRoom,distance} from './room-layout.mjs?v=rooms-v3';
import {VoiceInput} from './voice-input.mjs?v=voice-glow-v1';
import {parseVoiceCommand} from './voice-commands.mjs?v=local-voice-v1';
import {validateVoicePlan,executeVoicePlan,publicGameContext,doorApproach} from './voice-plan.mjs?v=gemini-v1';
import {VoiceOutput} from './voice-output.mjs?v=gemini-chat-v1';
import {mountEnvironmentOrb} from './chat-beam.bundle.mjs?v=environment-music-v4';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const audio=new SoundHuntAudio({silent:params.get('silent')==='1'});
const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const specifiedSeed=params.get('seed');
const initialSeed=specifiedSeed!==null&&/^\d+$/.test(specifiedSeed)?Number(specifiedSeed)>>>0:randomSeed();
let game=createGame(initialSeed), starting=false, paused=false, operation=0;
const navigationHud=new NavigationHUD({label:'初次穿行'});
const orbHost=document.createElement('div');orbHost.id='environment-orb';orbHost.hidden=true;orbHost.setAttribute('aria-hidden','true');document.body.append(orbHost);
const environmentOrb=mountEnvironmentOrb(orbHost,{readState:()=>game.stage==='explore'&&!starting&&!paused
  ?audio.getEnvironmentVisualState():{active:false,rms:0,proximity:0}});
let wrongMessage='',doorCueArmed=true,doorCueCount=0;
let voiceReady=false,voiceState='idle',voiceMessage='正在检查语音服务…',voiceEpoch=0,captureEpoch=0,executingVoice=false;
const seenVoiceRequests=new Set();
let motionTrace=[];
let dialogue=[],semanticMode=false,speechReady=false,tutorialSeen=false;
let chatExpanded=true,chatUnread=false;
const show=(id,on)=>$(id).toggleAttribute('hidden',!on);
const say=message=>{$('status').textContent=message;};
const point=p=>({x:40+p.x*55,y:480-p.y*55});
const ns='http://www.w3.org/2000/svg';
const replyVoice=new VoiceOutput({getContext:()=>audio.context,getToken:()=>voice.status?.csrfToken,
  getVolume:()=>Number($('volume').value)/100,
  isAllowed:()=>speechReady&&$('voice-output-enabled').checked&&!paused&&game.stage!=='ready',
  silent:params.get('silent')==='1',onState:(state,detail={})=>{
    audio.setVolume(Number($('volume').value)/100*(['speaking','silent'].includes(state)?.65:1));
    $('speech-status').textContent=state==='loading'?'正在准备语音…':state==='speaking'?'ElevenLabs 正在说话':state==='silent'?`静音验证：语音 ${detail.duration.toFixed(1)} 秒，输出 0`:state==='error'?detail.message:'';
    $('speech-status').dataset.state=state;
    if(detail.duration)$('speech-status').dataset.duration=String(detail.duration);
    if(detail.outputGain!==undefined)$('speech-status').dataset.outputGain=String(detail.outputGain);
  }});
function svgElement(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);if(text)el.textContent=text;return el;}
const motion=new SmoothMovement({getGame:()=>game,onUpdate:sample=>{
  checkDoorApproach();render();
  if($('motion-check')){
    const stats=audio.getStats();
    motionTrace.push({...sample,audioListener:stats.listener,panners:stats.voices.map(v=>v.pannerPosition)});
  }
}});
const voice=new VoiceInput({
  isAllowed:()=>game.stage==='explore'&&!starting&&!paused,
  getContext:()=>({context:publicGameContext(game),history:dialogue.slice(-8)}),
  onState:({state,message})=>{voiceState=state;voiceMessage=message;renderVoice();},
  onLevel:level=>$('voice-control').dispatchEvent(new CustomEvent('voice-level',{detail:level})),
  onTranscript:result=>dispatchVoice(result),
});

if(params.get('silent')==='1')$('mode').textContent='静音测试 · 不输出声音';
function invalidateVoice(){
  if(executingVoice)return;
  replyVoice.cancel();
  if(motion.active)$('voice-result').textContent='';
  voiceEpoch++;voice.cancel();
}
function renderVoice(){
  const active=game.stage==='explore'&&!starting&&!paused;
  show('voice-control',game.stage!=='ready');
  $('voice-talk').disabled=!active||!voiceReady||voiceState==='transcribing';
  $('voice-talk').textContent=voiceState==='recording'?'正在听 · 松开发送':voiceState==='permission'?'等待麦克风许可…':voiceState==='transcribing'?'正在识别…':'按住说话 · V';
  $('voice-talk').classList.toggle('recording',voiceState==='recording');
  $('voice-talk').setAttribute('aria-pressed',String(voiceState==='recording'));
  $('voice-status').textContent=paused?'声音已暂停。':voiceMessage;
  $('voice-status').dataset.state=paused?'paused':voiceState;
  $('voice-control').dataset.voiceState=paused?'paused':voiceState;
  show('voice-retry',!voiceReady||voiceState==='error'||voiceState==='unavailable');
  $('voice-retry').textContent=voiceReady&&$('voice-text').value.trim()?'重新发送':'重新连接';
  $('voice-text-send').disabled=!active||!voiceReady||voiceState==='transcribing'||!semanticMode;
  renderChatDisclosure();
}
function renderChatDisclosure(){
  show('chat-body',chatExpanded);
  $('voice-control').classList.toggle('is-collapsed',!chatExpanded);
  $('chat-toggle').setAttribute('aria-expanded',String(chatExpanded));
  $('chat-toggle').setAttribute('aria-label',`${chatExpanded?'收起':'展开'} Gemini 对话`);
  $('chat-toggle').textContent=chatExpanded?'收起':chatUnread?'展开 · 新消息':'展开';
  const notice=paused?'声音已暂停。':game.stage==='won'?$('status').textContent
    :['permission','recording','transcribing','error','unavailable'].includes(voiceState)?voiceMessage
    :wrongMessage?'上次找错了，可以继续寻找。':'';
  $('chat-collapsed-status').textContent=notice;
  show('chat-collapsed-status',!chatExpanded&&Boolean(notice));
}
function setChatExpanded(expanded){
  chatExpanded=expanded;
  if(expanded)chatUnread=false;
  renderChatDisclosure();
  if(expanded)$('chat-log').scrollTop=$('chat-log').scrollHeight;
}
async function initializeVoice(force=false){
  if(force)invalidateVoice();
  try{
    const status=await voice.init({force});voiceReady=Boolean(status?.configured);
    semanticMode=Boolean(status.understanding);show('voice-text',semanticMode);show('voice-text-send',semanticMode);
    speechReady=Boolean(status.speechOutput);
    $('voice-output-enabled').disabled=!speechReady;
    $('voice-provider').textContent=status.provider||'语音识别';
    $('voice-privacy').textContent=semanticMode
      ?'按住时录音。录音、游戏状态和最近对话交给 Google Gemini；回复文字交给 ElevenLabs 生成声音。本机不保存真人录音。'
      :status.local
      ?'仅在按住时录音，松开后在本机识别，不上传、不保存录音。建议戴耳机。'
      :'仅在按住时录音，松开后发送至 ElevenLabs 识别。本地不保存录音；建议戴耳机。';
    voiceMessage=voiceReady?'可以输入你听见的声音。':'语音服务未就绪，键盘仍可使用。';
    $('voice-help').textContent=semanticMode
      ?'按住 V 聊线索、问问题或确认猜测，也可以打字。每次可说 12 秒。'
      :`当前是固定口令模式，例如“前进两步”“开门”。每次最多 ${status.maxSeconds||12} 秒。`;
  }catch{voiceReady=false;voiceMessage='语音服务未连接。请检查本地服务后重试。';}
  renderVoice();
}
function startVoice(){
  if(!voiceReady||game.stage!=='explore'||starting||paused||['permission','recording','transcribing'].includes(voiceState))return;
  invalidateVoice();motion.cancel();
  setChatExpanded(true);
  captureEpoch=voiceEpoch;$('voice-result').textContent='';void voice.start();
}
function dispatchVoice(result){
  const {text,requestId,recognitionMs}=result;
  if(captureEpoch!==voiceEpoch||game.stage!=='explore'||starting||paused||seenVoiceRequests.has(requestId))return;
  if(requestId){seenVoiceRequests.add(requestId);if(seenVoiceRequests.size>100)seenVoiceRequests.delete(seenVoiceRequests.values().next().value);}
  if(semanticMode||result.mode){void dispatchSemantic(result);return;}
  const parsed=parseVoiceCommand(text);
  if(!parsed.ok){$('voice-result').textContent=`听到：“${text||'…'}”。${parsed.reason}`;return;}
  executingVoice=true;
  let outcome='';
  const heard=`听到：“${text}”${Number.isFinite(recognitionMs)?`（识别 ${(recognitionMs/1000).toFixed(2)} 秒）`:''}`;
  try{
    const command=parsed.command;
    $('map').dataset.lastVoiceAction=command.type;
    if(command.type==='move'||command.type==='turn'){
      const epoch=voiceEpoch,round=game;
      act(command.direction,command.type==='move'?command.steps:command.degrees/30,result=>{
        if(epoch!==voiceEpoch||game!==round||paused)return;
        const detail=result.status==='completed'?`已${parsed.label}`:result.status==='blocked'?`走了 ${result.travelled.toFixed(2)} 米，前方被挡住。`:'已停在当前位置。';
        $('voice-result').textContent=`${heard} → ${detail}`;
      });
      $('voice-result').textContent=`${heard} → 正在${parsed.label}…`;
      return;
    }else if(command.type==='door'){
      motion.cancel();
      if(game.doorOpen===(command.state==='open'))outcome=game.doorOpen?'门已经打开。':'门已经关闭。';
      else{useDoor();outcome=$('status').textContent;}
    }else if(command.type==='confirm'){motion.cancel();confirm();outcome=$('status').textContent;}
    else if(command.type==='pause'){pauseGame();outcome='已暂停声音。';}
    $('voice-result').textContent=`${heard} → ${outcome}`;
  }finally{executingVoice=false;}
}

function remember(role,text){
  dialogue.push({role,text:String(text).slice(0,600)});
  dialogue=dialogue.slice(-40);
  $('chat-log').replaceChildren();
  for(const item of dialogue){
    const row=document.createElement('div');row.className=`chat-line ${item.role}`;
    const name=document.createElement('span');name.className='speaker';name.textContent=item.role==='user'?'你':'Gemini';
    const content=document.createElement('span');content.textContent=item.text;row.append(name,content);$('chat-log').append(row);
  }
  $('chat-log').scrollTop=$('chat-log').scrollHeight;
  if(role==='assistant'&&!chatExpanded)chatUnread=true;
  renderChatDisclosure();
  if(role==='assistant')void replyVoice.speak(String(text).slice(0,400));
}
async function dispatchSemantic(result){
  let plan;
  try{plan=validateVoicePlan(result);}catch(error){$('voice-reply').textContent=error.message;return;}
  const epoch=voiceEpoch,round=game;
  const current=()=>epoch===voiceEpoch&&game===round&&game.stage==='explore'&&!paused;
  const heard=plan.text?`你说：“${plan.text}”`:'没有听到清晰的话';
  $('voice-result').textContent=heard+(Number.isFinite(result.recognitionMs)?`（理解 ${(result.recognitionMs/1000).toFixed(2)} 秒）`:'');
  $('voice-reply').textContent=plan.message;
  if(plan.text)remember('user',plan.text);
  if(plan.mode!=='act'){remember('assistant',plan.message);$('voice-reply').textContent='';return;}
  const motionStep=(forward,turn)=>new Promise(resolve=>{
    if(!current())return resolve({status:'cancelled',message:'已取消。'});
    const direction=turn?(turn<0?'left':'right'):(forward<0?'back':'forward');
    const count=turn?Math.abs(turn)/30:Math.abs(forward)/0.5;
    act(direction,count,result=>resolve({status:result.status,message:result.status==='completed'
      ?turn?`已${turn<0?'左':'右'}转 ${Math.abs(turn)} 度。`:`已${forward<0?'后退':'前进'} ${Math.abs(forward).toFixed(2)} 米。`
      :result.status==='blocked'?`走了 ${result.travelled.toFixed(2)} 米，前方被墙或门挡住，已停下。`:'已停在当前位置。'}));
  });
  try{
    const outcome=await executeVoicePlan(plan,{isCurrent:current,
      onProgress:(i,n)=>{$('voice-reply').textContent=`${plan.message}\n正在执行 ${i+1}/${n}…`;},
      perform:async action=>{
        if(action.type==='move')return motionStep(action.amount,0);
        if(action.type==='turn')return motionStep(0,action.amount);
        if(action.type==='approachDoor'){
          const approach=doorApproach(game,action.amount);
          if(approach.metres<0.01)return {status:'completed',message:'已经在门旁。'};
          if(Math.abs(approach.degrees)>0.1){
            const turned=await motionStep(0,approach.degrees);
            if(turned.status!=='completed'||!current())return turned;
          }
          return motionStep(approach.metres,0);
        }
        if(!current())return {status:'cancelled',message:'已取消。'};
        executingVoice=true;
        try{
          motion.cancel();
          if(action.type==='door'){
            const desired=action.state==='open';
            if(game.doorOpen===desired)return {status:'completed',message:desired?'门已经打开。':'门已经关闭。'};
            useDoor();
            return {status:game.doorOpen===desired?'completed':'blocked',message:$('status').textContent};
          }
          if(action.type==='confirm'){
            const near=nearbySource(game);confirm();
            return {status:near?'completed':'blocked',message:$('status').textContent};
          }
          if(action.type==='pause'){pauseGame();return {status:'completed',message:'声场已暂停，点击“继续声音”恢复。'};}
          say('已停止移动。');render();return {status:'completed',message:'已停止移动。'};
        }finally{executingVoice=false;}
      }});
    if(epoch!==voiceEpoch||game!==round)return;
    const feedback=outcome.results.map(r=>r.message).join(' ');
    $('voice-reply').textContent='';
    remember('assistant',feedback||plan.message);
  }catch{
    if(epoch===voiceEpoch&&game===round){$('voice-reply').textContent='动作没有完成，已停下。';motion.cancel();remember('assistant','动作执行中断，已停在当前位置。');}
  }
}
function renderRoom(){
  $('walls').replaceChildren();
  for(const wall of WALLS){
    const a=point(wall.a),b=point(wall.b);
    $('walls').append(svgElement('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,'stroke-width':7,stroke:'#87929b','stroke-linecap':'round'}));
  }
  const a=point(DOOR.a),b=point(DOOR.b);
  const end=game.doorOpen?{x:a.x+(b.y-a.y)*-1,y:a.y}:b;
  $('door-leaf').setAttribute('d',`M${a.x} ${a.y}L${end.x} ${end.y}`);
  $('door-leaf').classList.toggle('is-open',game.doorOpen);
  $('door-label').textContent=game.doorOpen?'门 · 已打开':'门 · 已关闭';
  $('room-position').textContent=insideRoom(game.player)?'房间内':'房间外';
  $('door-state').textContent=game.doorOpen?'房门已打开':'房门已关闭';
  $('door-hint').textContent=isNearDoor(game.player)?'门就在附近，按 F 或点击按钮开关。':'靠近门会听到提示音，再按 F 开关门。';
  $('door-toggle').textContent=game.doorOpen?'关门 · F':'开门 · F';
  $('door-toggle').disabled=!isNearDoor(game.player)||starting||paused;
  $('map').dataset.doorOpen=String(game.doorOpen);
  $('map').dataset.doorCueCount=String(doorCueCount);
}
function checkDoorApproach(){
  const d=distance(game.player,DOOR.center);
  if(d>DOOR.rearmRadius)doorCueArmed=true;
  if(d<=DOOR.nearRadius&&doorCueArmed){
    if(audio.playCue('door',DOOR.center))doorCueCount++;
    doorCueArmed=false;
  }
}
function render(){
  orbHost.hidden=game.stage!=='explore';
  show('intro',game.stage==='ready');show('exploring',game.stage==='explore');show('victory',game.stage==='won');
  show('pause',game.stage==='explore'||starting);show('reset',game.stage!=='ready'||starting);
  show('movement',game.stage==='explore');show('keys',game.stage==='explore');
  show('door-control',game.stage==='explore');
  show('wrong-feedback',Boolean(wrongMessage)&&game.stage==='explore');
  if($('wrong-message').textContent!==wrongMessage)$('wrong-message').textContent=wrongMessage;
  $('pause').textContent=starting?'取消加载':paused?'继续声音':'暂停声音';
  $('start').disabled=starting;$('start').textContent=starting?'正在准备环境声音…':'进入黑暗';
  document.querySelectorAll('[data-action]').forEach(b=>{b.disabled=starting||paused;});
  const near=nearbySource(game);
  $('confirm').disabled=!near||starting||paused;
  $('confirm').textContent=near?'这里是雨声吗？按 E 确认':'靠近声源后按 E';
  $('step-listen').className=game.stage==='ready'?'current':'done';
  $('step-find').className=game.stage==='explore'?'current':game.stage==='won'?'done':'';
  $('step-confirm').className=game.stage==='won'?'current':'';
  $('attempts').textContent=game.attempts;
  navigationHud.update({player:game.player,active:game.stage==='explore',paused,roundKey:game});
  $('coords').value=`${game.player.x.toFixed(1)}, ${game.player.y.toFixed(1)} m`;
  $('map').dataset.moving=String(Boolean(motion.active));
  const p=point(game.player);
  $('player').setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${game.player.heading*180/Math.PI})`);
  $('sources').replaceChildren();
  for(const source of game.sources){
    if(!$('help').checked&&game.stage!=='won'&&!game.checked.includes(source.id))continue;
    const s=point(source),target=game.stage==='won'&&source.soundId===TARGET_SOUND;
    const g=svgElement('g',{transform:`translate(${s.x} ${s.y})`});
    if(target)g.append(svgElement('circle',{r:48,fill:'url(#halo)'}));
    g.append(svgElement('circle',{r:11,fill:target?'#dfba7f':'#253542',stroke:target?'#dfba7f':'#8797a6','stroke-width':1.5}));
    if(game.checked.includes(source.id))g.append(svgElement('path',{d:'M-4 -4L4 4M-4 4L4 -4',stroke:'#f1b19b','stroke-width':2,fill:'none'}));
    else g.append(svgElement('circle',{r:3,fill:target?'#172027':'#b9c6d0'}));
    const label=game.stage==='won'?`${target?'目标 · ':''}${SOUNDS[source.soundId].label}`:game.checked.includes(source.id)?'已排除':'声源';
    g.append(svgElement('text',{y:31},label));$('sources').append(g);
  }
  show('route',game.stage==='won');
  if(game.stage==='won')$('route').setAttribute('points',game.route.map(p=>{const s=point(p);return `${s.x},${s.y}`;}).join(' '));
  renderRoom();renderVoice();audio.setDoorOpen(game.doorOpen);audio.setPose(game.player,{continuous:Boolean(motion.active)});
}

function pauseGame(message='声场已暂停。点击“继续声音”恢复。'){
  invalidateVoice();
  motion.cancel();
  operation++;audio.pause();starting=false;paused=game.stage==='explore';say(message);render();
}
async function beginOrResume(){
  if(starting||game.stage==='won')return;
  invalidateVoice();
  const token=++operation;starting=true;say('正在准备环境声场…');render();
  try{
    await audio.init();
    if(token!==operation)return;
    if(document.hidden){pauseGame('声音已暂停。回到页面后手动开始。');return;}
    audio.setVolume(Number($('volume').value)/100);audio.setMix(Object.keys(SOUNDS));
    audio.setDoorOpen(game.doorOpen);
    const started=await audio.startScene(game.sources,game.player);
    if(token!==operation||!started)return;
    if(document.hidden){pauseGame('声音已暂停。回到页面后手动开始。');return;}
    game.stage='explore';paused=false;
    tutorialSeen=true;document.body.classList.add('has-entered');
    $('voice-reply').textContent='';
    say('目标是雨声。靠近门会有提示音，按 F 开门；走近声源后按 E 确认。');
    checkDoorApproach();
  }catch(error){if(token===operation){audio.pause();paused=game.stage==='explore';say(`环境声音加载失败：${error.message}。请重试。`);if(tutorialSeen)$('voice-reply').textContent=$('status').textContent;}}
  finally{if(token===operation){starting=false;render();}}
}
function newRound(){
  invalidateVoice();$('voice-result').textContent='';
  dialogue=[];chatUnread=false;$('voice-reply').textContent='';
  $('chat-log').replaceChildren();
  motion.cancel();
  operation++;audio.pause();starting=false;paused=false;audio.setMix(Object.keys(SOUNDS));
  wrongMessage='';doorCueArmed=true;doorCueCount=0;
  let next=createGame(randomSeed());
  for(let i=0;i<8&&next.sources.every((s,j)=>s.soundId===game.sources[j].soundId);i++)next=createGame(randomSeed());
  if(next.sources.every((s,j)=>s.soundId===game.sources[j].soundId)){
    const sounds=next.sources.map(s=>s.soundId);next.sources.forEach((s,i)=>{s.soundId=sounds[(i+1)%3];});
  }
  game=next;say('新的一局已打乱声音的位置。目标仍然是找到雨声。');render();
  if(tutorialSeen)void beginOrResume();
}
function act(action,count=1,onComplete=null){
  if(starting||paused||game.stage!=='explore')return;
  const turn=action==='left'?-Math.PI/6:action==='right'?Math.PI/6:0;
  const amount=action==='forward'?0.5:action==='back'?-0.5:0;
  motion.cancel();motionTrace=[];
  motion.start({forward:amount*count,turn:turn*count,action,onComplete:result=>{
    const near=nearbySource(game);
    if(result.status==='blocked')say('前面是墙或关闭的门，请转向；靠近门按 F 打开。');
    else if(result.status==='cancelled')say('已停在当前位置。');
    else say(near?(game.checked.includes(near.id)?'这里不是雨声，继续寻找其他方向。':'附近有一个声源。认为这是雨声，再按 E 确认。'):isNearDoor(game.player)?'你已靠近房门。按 F 开关，听门内外声音的变化。':'听雨声的方向和远近，继续移动。');
    if($('motion-check'))$('motion-check').textContent=JSON.stringify({result,samples:motionTrace});
    render();
    if(result.status==='blocked'&&!onComplete)remember('assistant','前方被墙或关闭的门挡住，已停下。');
    onComplete?.(result);
  }});
  say(turn?'正在转身，声音方向随朝向变化。':'正在行走，听声音如何逐渐靠近或远离。');render();
}
function useDoor(){
  if(starting||paused||game.stage!=='explore')return;
  const result=toggleDoor(game);
  const messages={opened:'门打开了。听门内传来的声音，穿过门口继续探索。',closed:'门关上了。门另一侧的声音现在更轻、更闷。',far:'再靠近门一些，然后按 F。',occupied:'你正站在门槛上。先向门内或门外走半米，再关门。'};
  if(messages[result])say(messages[result]);
  render();
  if(messages[result]&&!executingVoice)remember('assistant',messages[result]);
}
function confirm(){
  if(starting||paused||game.stage!=='explore')return;
  const {result}=confirmSource(game);
  if(result==='far')say('还没有靠近任何声源。继续循着雨声走近。');
  if(result==='already')say('这个声源已经排除，不必重复确认。');
  if(result==='wrong'){
    wrongMessage='上一次确认的声源不是雨声。继续寻找其他位置。';
    audio.playCue('wrong');say('找错了，这里不是雨声。你可以继续寻找。');
  }
  if(result==='won'){wrongMessage='';operation++;audio.pause();starting=false;paused=false;say(`找到雨声了！这一局结束，你一共确认了 ${game.attempts} 次。`);}
  render();
  if(!executingVoice)remember('assistant',$('status').textContent);
}
$('start').addEventListener('click',beginOrResume);
$('chat-toggle').addEventListener('click',()=>setChatExpanded(!chatExpanded));
$('voice-text-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const text=$('voice-text').value.trim();
  if(!text||!semanticMode||!voiceReady||game.stage!=='explore'||starting||paused||['recording','permission','transcribing'].includes(voiceState))return;
  invalidateVoice();motion.cancel();captureEpoch=voiceEpoch;
  $('voice-result').textContent='';$('voice-reply').textContent='';
  if(await voice.sendText(text))$('voice-text').value='';
});
$('pause').addEventListener('click',()=>{if(paused&&!starting)beginOrResume();else pauseGame(starting?'加载已取消。准备好后可以重新开始。':undefined);});
$('reset').addEventListener('click',newRound);$('again').addEventListener('click',newRound);
$('confirm').addEventListener('click',()=>{invalidateVoice();motion.cancel();confirm();});$('help').addEventListener('change',render);
$('door-toggle').addEventListener('click',()=>{invalidateVoice();motion.cancel();useDoor();});
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{invalidateVoice();act(b.dataset.action);}));
$('voice-talk').addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);startVoice();});
$('voice-talk').addEventListener('pointerup',()=>{void voice.stop();});
$('voice-talk').addEventListener('pointercancel',invalidateVoice);
$('voice-talk').addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat)startVoice();}});
$('voice-talk').addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();void voice.stop();}});
$('voice-retry').addEventListener('click',async()=>{
  const text=$('voice-text').value.trim();
  if(!voiceReady||voice.lastError?.code==='session')await initializeVoice(true);
  if(text&&voiceReady)$('voice-text-form').requestSubmit();
  else if(voiceReady)await initializeVoice(true);
});
$('volume').addEventListener('input',event=>{audio.setVolume(Number(event.target.value)/100);replyVoice.setVolume();$('volume-value').value=`${event.target.value}%`;});
$('voice-output-enabled').addEventListener('change',()=>{if(!$('voice-output-enabled').checked)replyVoice.cancel();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(event.target.matches('input,textarea'))event.target.blur();
    invalidateVoice();motion.cancel();return;
  }
  if(event.metaKey||event.ctrlKey||event.altKey||event.target.closest('select,textarea,input:not([type="checkbox"]):not([type="range"])'))return;
  const key=event.key.toLowerCase();
  if(event.target.matches('input[type="range"]')&&key.startsWith('arrow'))return;
  const action={arrowup:'forward',arrowdown:'back',arrowleft:'left',arrowright:'right'}[key];
  if(action){event.preventDefault();if(event.repeat&&motion.active?.action===action)return;invalidateVoice();act(action);}
  if(key==='e'&&!event.repeat){event.preventDefault();invalidateVoice();motion.cancel();confirm();}
  if(key==='f'&&!event.repeat){event.preventDefault();invalidateVoice();motion.cancel();useDoor();}
  if(key==='v'&&!event.repeat){event.preventDefault();startVoice();}
  if(key==='p'&&!event.repeat){event.preventDefault();if(paused&&!starting)void beginOrResume();else if(game.stage==='explore')pauseGame();}
  if(key==='escape'){invalidateVoice();motion.cancel();}
});
document.addEventListener('keyup',event=>{if(event.key.toLowerCase()==='v'){event.preventDefault();void voice.stop();}});
window.addEventListener('blur',()=>{invalidateVoice();motion.cancel();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){invalidateVoice();if(starting||game.stage==='explore'&&!paused)pauseGame('页面切到后台，声音已暂停。回来后手动继续。');}});
window.addEventListener('pagehide',()=>{voice.destroy();replyVoice.cancel();motion.cancel();audio.pause();environmentOrb.destroy();});
// Explicit silent QA only: a generated file can exercise the real provider and
// the exact game dispatcher without opening a microphone or playing audio.
if(params.get('silent')==='1'&&params.get('voicecheck')==='1'){
  const test=document.createElement('button');test.id='voice-fixture';test.textContent='测试实际识别：往前走一点（合成文件）';
  test.addEventListener('click',async()=>{
    if(game.stage!=='explore'||paused||starting)return;
    const epoch=voiceEpoch;captureEpoch=epoch;test.disabled=true;
    try{const response=await fetch('./validation/local-speech/forward-little.wav');if(!response.ok)throw new Error('测试录音缺失');const wav=await response.blob();if(epoch!==voiceEpoch||paused||game.stage!=='explore')return;await voice.transcribeWav(wav);}
    catch{$('voice-result').textContent='合成录音测试未完成。';}
    finally{test.disabled=false;}
  });
  $('voice-control').append(test);
  const trace=document.createElement('pre');trace.id='motion-check';trace.style.cssText='max-height:130px;overflow:auto;font-size:10px;white-space:pre-wrap';
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='静音测试：逐帧位置与声音轨迹';details.append(summary,trace);$('voice-control').append(details);
}
render();
void initializeVoice();
