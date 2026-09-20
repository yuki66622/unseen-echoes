// The chapter bridge lives only in this cloud release, leaving upstream work intact.
const params=new URLSearchParams(location.search);
const isTutorial=location.pathname.startsWith('/tutorial');
const get=key=>{try{return sessionStorage.getItem(key);}catch{return null;}};
const set=(key,value)=>{try{sessionStorage.setItem(key,value);}catch{}};
const nextURL=(path,chapter)=>{const u=new URL(path,location.origin);if(params.get('silent')==='1')u.searchParams.set('silent','1');if(chapter)u.searchParams.set('chapter',chapter);return u;};
const nav=document.createElement('nav');nav.className='journey-nav';nav.setAttribute('aria-label','游戏章节');
const title=document.createElement('span');title.textContent=isTutorial?'找到雨声':'第二关 · Pinewood Inn';
const back=document.createElement('a');back.href=nextURL('/','title');back.textContent='返回标题';back.addEventListener('click',()=>{try{sessionStorage.removeItem('unseen-checkpoint');}catch{}});
nav.append(title,back);
if(isTutorial){
  const skip=document.createElement('a');skip.href=nextURL('/','lobby');skip.textContent='跳过教程';nav.append(skip);
  const continueButton=document.createElement('a');continueButton.className='journey-continue';continueButton.href=nextURL('/','lobby');continueButton.textContent='教程完成 · 进入双人追逐';continueButton.hidden=true;document.body.append(continueButton);
  const victory=document.getElementById('victory');
  const update=()=>{const won=!victory.hidden;continueButton.hidden=!won;if(won)set('unseen-tutorial-complete','1');};
  new MutationObserver(update).observe(victory,{attributes:true,attributeFilter:['hidden']});update();
  set('unseen-checkpoint','tutorial');
}else{
  set('unseen-checkpoint','hotel');
  const ending=document.getElementById('ending');
  const finishLink=document.createElement('a');finishLink.className='journey-finish';finishLink.id='next-world';finishLink.textContent='生成新世界';finishLink.href=nextURL('/world/');finishLink.onclick=()=>{try{sessionStorage.removeItem('unseen-checkpoint');}catch{}};ending.append(finishLink);
  // Avoid treating a timed review as a player-submitted correct explanation.
  document.documentElement.dataset.chapter='hotel';
}
document.body.append(nav);
