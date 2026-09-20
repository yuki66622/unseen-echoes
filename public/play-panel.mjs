import {mountEnvironmentOrb} from './chat-beam.bundle.mjs';
export class PlayPanel{
 constructor({chapter,readState}){
  this.host=document.createElement('aside');this.host.id='play-panel';this.host.hidden=true;this.host.setAttribute('aria-label','声音与按键');
  const orb=document.createElement('div');orb.id='environment-orb';orb.setAttribute('aria-hidden','true');this.host.append(orb);
  let keys=document.querySelector('.key-legend');
  if(!keys){keys=document.createElement('div');keys.className='key-legend';const rows=[['↑ ↓','前进 / 后退'],['← →','向左 / 向右转'],...(chapter!=='chase'?[['F','开关门']]:[]),['E','确认 / 交互'],['P','暂停'],...(chapter==='hotel'?[['V','按住说话'],['Esc','退出输入 / 停下']]:chapter==='chase'?[['Space','停下']]:[['Esc','退出输入 / 停下']])];keys.innerHTML='<p class="eyebrow">按键</p><dl>'+rows.map(([key,label])=>`<div><dt><kbd>${key}</kbd></dt><dd>${label}</dd></div>`).join('')+'</dl>';}
  this.host.append(keys);document.body.append(this.host);this.orb=mountEnvironmentOrb(orb,{readState});
 }
 destroy(){this.orb.destroy();this.host.remove();}
 update(active){if(this.host.hidden===active)this.host.hidden=!active;}
}
// Keep the map centred in the remaining play area above the conversation.
if(typeof document!=='undefined'){
 const layout=()=>{const chat=document.querySelector('#chat:not([hidden]),body.has-entered #voice-control');const h=chat?.getBoundingClientRect().height||120;const end=Math.max(140,innerHeight-h-34),space=end-70;document.documentElement.style.setProperty('--map-center',`${70+space/2}px`);document.documentElement.style.setProperty('--map-max-width',`${Math.max(70,(space-28)*1.2)}px`);};
 const observer=new ResizeObserver(layout);for(const node of document.querySelectorAll('#chat,#voice-control'))observer.observe(node);addEventListener('resize',layout);layout();
}
