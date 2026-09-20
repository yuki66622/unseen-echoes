"""Cloud-only chapter bridges. Run after an explicit owner-authorized source refresh."""
from pathlib import Path
PUBLIC=Path(__file__).resolve().parent/'public'
p=PUBLIC/'opening.html'
s=p.read_text()
if '/nebula-opening.mjs' not in s:
    s+='''\n<style>.ue-game{position:relative;isolation:isolate;overflow:hidden}#unseen-echoes-opening .nebula-backdrop{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;transition:opacity .65s}#unseen-echoes-opening h1,#unseen-echoes-opening .ue-body{text-shadow:0 2px 20px #000}@media(prefers-reduced-motion:reduce){.nebula-backdrop{transition:none!important}}</style><script src="/nebula-source.js"></script><script type="module" src="/nebula-opening.mjs"></script>\n'''
s=s.replace('.ue-game{position:relative;', '.ue-game{min-height:100dvh!important;position:relative;')
p.write_text(s)
p=PUBLIC/'multiplayer/client.mjs';s=p.read_text()
if 'function navigateChapter(' not in s:
    old="$('tutorial-entry').addEventListener('click',()=>{resetLocal('tutorial');setPhase('tutorial-ready');say('');});"
    assert old in s
    s=s.replace(old,"$('tutorial-entry').addEventListener('click',()=>navigateChapter('/tutorial/'));")
    start=s.index('async function enterStory(){');end=s.index('\n}',start)+2
    s=s[:start]+'''async function enterStory(){
  if(enteringStory)return;
  enteringStory=true;stopSound();motion=null;pending=null;
  if(room?.ready)try{await room.call('leaveRoom',{});}catch{}
  room?.disconnect();room=null;roomState=null;
  sessionSet('unseen-checkpoint','hotel');navigateChapter('/hotel/');
}'''+s[end:]
    s=s.replace("const checkpoint=sessionGet('unseen-checkpoint');", "function navigateChapter(path){const url=new URL(path,location.origin);if(silent)url.searchParams.set('silent','1');location.assign(url);}\nconst requestedChapter=params.get('chapter');\nif(requestedChapter==='title')sessionRemove('unseen-checkpoint');\nconst checkpoint=requestedChapter==='lobby'?'lobby':sessionGet('unseen-checkpoint');")
    s=s.replace("else if(checkpoint==='story')void enterStory();", "else if(checkpoint==='story'||checkpoint==='hotel')void enterStory();\nelse if(checkpoint==='tutorial')navigateChapter('/tutorial/');")
s=s.replace('new MutationObserver(refresh)','new (doc.defaultView.MutationObserver)(refresh)').replace('循着脚步声，找到求生者。','循着心跳声，找到求生者。')
p.write_text(s)
p=PUBLIC/'index.html';s=p.read_text().replace('序章 → 教程 → 双人追逐 → 个人故事','序章 → 找雨教程 → 双人追逐 → 旅馆调查').replace('进入你的个人故事','进入旅馆调查');p.write_text(s)
print('Applied chapter bridges without changing upstream gameplay.')
