// Menu rain is shared across chapters. The opening score plays once per tab journey.
if(window.top===window){
 const root=document.documentElement,params=new URLSearchParams(location.search),silent=params.get('silent')==='1';
 const audio=new Audio('/assets/menu-rain.mp3');audio.loop=true;audio.preload='auto';audio.muted=silent;
 const storageGet=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
 const storageSet=key=>{try{sessionStorage.setItem(key,'1');}catch{}};
 const openingPage=location.pathname==='/'&&(!params.get('chapter')||params.get('chapter')==='title');
 const freshOpening=openingPage&&performance.getEntriesByType('navigation')[0]?.type==='reload';
 const score=openingPage?new Audio('/assets/opening-piano.mp3'):null;
 if(score){score.preload='auto';score.muted=silent;score.volume=0;}
 let unlocked=storageGet('unseen-audio-unlocked')==='1',scoreDone=!openingPage||(!freshOpening&&storageGet('unseen-opening-score-played')==='1'),scoreStarted=false,scorePending=false,delayUntil=0,delayTimer=0,mixTimer=0,disposed=false;
 if(!openingPage)storageSet('unseen-opening-score-played');
 function menu(){
  if(root.dataset.uiChapter==='tutorial')return !document.getElementById('victory')?.hidden||(!document.body.classList.contains('has-entered')&&document.body.dataset.audioStarting!=='true');
  if(root.dataset.uiChapter==='hotel')return !document.getElementById('intro')?.hidden||!document.getElementById('ending')?.hidden;
  return !['chase','tutorial','story','world'].includes(document.body.dataset.phase);
 }
 const opening=()=>openingPage&&(!document.body.dataset.phase||document.body.dataset.phase==='opening');
 function volume(){
  const control=document.getElementById('volume'),fraction=Math.max(0,Math.min(1,control?Number(control.value)/Number(control.max||100):.75));
  const underScore=score&&!scoreDone&&opening()&&unlocked;
  audio.volume=silent?0:.16*fraction*(underScore ? .1 : 1);
  if(score){const t=score.currentTime,remaining=Number.isFinite(score.duration)?score.duration-t:Infinity;const envelope=Math.max(0,Math.min(1,t/3,remaining/3));score.volume=silent?0:.55*fraction*envelope;root.dataset.openingScoreGain=String(envelope);}
 }
 function finishScore(){scoreDone=true;clearTimeout(delayTimer);clearInterval(mixTimer);score?.pause();if(score)score.volume=0;storageSet('unseen-opening-score-played');root.dataset.openingScore='finished';volume();}
 function sync(){
  if(disposed)return;
  if(!opening()&&!scoreDone)finishScore();
  const active=menu()&&!document.hidden;volume();root.dataset.menuAudio=active?'ready':'off';
  if(!active){audio.pause();score?.pause();clearTimeout(delayTimer);return;}
  if(unlocked&&audio.paused)void audio.play().then(()=>{if(disposed||!menu()||document.hidden)audio.pause();else root.dataset.menuAudio='playing';}).catch(()=>{root.dataset.menuAudio='awaiting-gesture';});
  if(!score||scoreDone||!opening()||!unlocked)return;
  if(!delayUntil)delayUntil=performance.now()+2000;
  const remaining=delayUntil-performance.now();
  if(!scoreStarted&&remaining>0){root.dataset.openingScore='waiting';clearTimeout(delayTimer);delayTimer=setTimeout(sync,remaining);return;}
  if(!score.paused||scorePending)return;
  scorePending=true;
  void score.play().then(()=>{
   scorePending=false;if(disposed||scoreDone||!opening()){finishScore();return;}
   scoreStarted=true;storageSet('unseen-opening-score-played');root.dataset.openingScore='playing';
   if(document.hidden)score.pause();
   clearInterval(mixTimer);mixTimer=setInterval(volume,50);volume();
  }).catch(()=>{scorePending=false;root.dataset.openingScore='awaiting-gesture';});
 }
 score?.addEventListener('ended',finishScore);score?.addEventListener('error',finishScore);score?.addEventListener('timeupdate',volume);
 function activate(){unlocked=true;storageSet('unseen-audio-unlocked');sync();}
 for(const name of ['pointerdown','keydown'])document.addEventListener(name,activate,{capture:true});
 const frame=document.getElementById('opening-frame');
 function wireFrame(){try{for(const name of ['pointerdown','keydown'])frame.contentDocument.addEventListener(name,activate,{capture:true});}catch{}}
 if(frame){frame.addEventListener('load',wireFrame);wireFrame();}
 const observer=new MutationObserver(sync);observer.observe(document.body,{attributes:true,attributeFilter:['class','data-phase','data-audio-starting']});
 for(const id of ['intro','ending','victory']){const el=document.getElementById(id);if(el)observer.observe(el,{attributes:true,attributeFilter:['hidden']});}
 document.addEventListener('visibilitychange',sync);document.getElementById('volume')?.addEventListener('input',volume);
 addEventListener('pageshow',event=>{if(event.persisted){disposed=false;sync();}});
 addEventListener('pagehide',()=>{disposed=true;audio.pause();if(score&&!scoreDone)finishScore();clearTimeout(delayTimer);clearInterval(mixTimer);});
 if(params.get('qa')==='1'||params.get('debug')==='1')window.__menuAudio={state:()=>({source:new URL(audio.src).pathname,loop:audio.loop,paused:audio.paused,currentTime:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:null,volume:audio.volume,muted:audio.muted,menu:menu(),unlocked,score:score?{source:new URL(score.src).pathname,paused:score.paused,currentTime:score.currentTime,duration:Number.isFinite(score.duration)?score.duration:null,volume:score.volume,started:scoreStarted,done:scoreDone,status:root.dataset.openingScore,gain:Number(root.dataset.openingScoreGain)}:null})};
 sync();
}
