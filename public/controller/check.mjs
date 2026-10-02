import {attachGamepad} from '../gamepad-input.mjs';
const $=id=>document.getElementById(id);
const names=['A','B','X','Y','LB','RB','LT','RT','View','Menu','L3','R3','↑','↓','←','→','Xbox'];
const buttons=names.map(name=>{const el=document.createElement('span');el.textContent=name;el.dataset.pressed='false';$('buttons').append(el);return el;});
let paused=false,count=0;
const labels={waiting:'尚未检测到手柄：连接后按一下按钮。',unsupported:'浏览器不支持，或设备未提供 standard 映射。',ready:'已识别，可以检查摇杆和按钮。',neutral:'请松开所有摇杆和按钮，回中后再试。',paused:'输入已暂停；回到此页或按 Menu 恢复。'};
const actions={forward:'前进',back:'后退',left:'左转',right:'右转',interact:'查看 / 交互',door:'开关门'};
const controller=attachGamepad({
  isEnabled:()=>!paused,canPause:()=>true,
  onAction:action=>{$('action').textContent=`${actions[action]} · 第 ${++count} 次动作`;},
  onStop:()=>{$('action').textContent='已停止';},
  onPause:()=>{paused=!paused;$('action').textContent=paused?'已暂停':'已恢复，请先回中';},
  onStatus:state=>{
    const label=labels[state.state]||labels.waiting;if($('status').textContent!==label)$('status').textContent=label;
    $('device').textContent=state.id?`${state.id} · mapping: ${state.mapping||'未提供'}`:'';
    for(let i=0;i<4;i++){const value=state.axes?.[i]||0;$(`axis-${i}`).value=value;$(`value-${i}`).textContent=value.toFixed(2);}
    buttons.forEach((el,i)=>{el.dataset.pressed=String((state.buttons?.[i]||0)>.5);});
  },
});
window.addEventListener('pagehide',event=>{if(event.persisted)controller.reset();else controller.destroy();});
