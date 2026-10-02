import {attachGamepad} from './gamepad-input.mjs';
import {getLanguage} from './locale-state.mjs';

// Chapters supply their own actions; this layer owns status and focus guards.
export function mountGamepad(options) {
  const host=document.createElement('details');
  host.className='gamepad-help';host.dataset.noLocalize='';
  const summary=document.createElement('summary'),status=document.createElement('span');
  status.setAttribute('role','status');summary.append(status);
  const description=document.createElement('p'),link=document.createElement('a');
  link.href='/controller/';link.target='_blank';link.rel='noopener';
  host.append(summary,description,link);
  const parent=options.host||document.querySelector('footer')||document.querySelector('main')||document.body;
  parent.append(host);
  if(!document.querySelector('link[data-gamepad-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/gamepad-controls.css';style.dataset.gamepadStyle='';document.head.append(style);
  }
  let latest={state:'waiting'};
  const render=()=>{
    const en=getLanguage()==='en';
    const labels=en?{waiting:'Controller · press a button to connect',unsupported:'Controller · unsupported layout',ready:'Controller connected',neutral:'Controller · release sticks and buttons',paused:'Controller · inactive'}
      :{waiting:'手柄 · 连接后按一下按钮',unsupported:'手柄 · 暂不支持此映射',ready:'手柄已连接',neutral:'手柄 · 请松开摇杆和按钮',paused:'手柄 · 当前未启用'};
    const label=labels[latest.state]||labels.waiting;
    if(status.textContent!==label)status.textContent=label;
    description.textContent=en?'Left stick: forward/back. Right stick: turn. D-pad also works. A: inspect. X: door. B: stop. Menu: pause/resume. Hold to repeat; release to stop. Turning takes priority. Use the mouse for menus and first entry.'
      :'左杆前后走，右杆左右转；方向键也可操作。A 查看，X 开关门，B 停止，Menu 暂停/恢复。持杆连续执行，松手停止，转向优先。菜单和首次进入仍用鼠标。';
    link.textContent=en?'Open silent controller check':'打开无声手柄检查';
  };
  const typing=()=>Boolean(document.activeElement?.closest('input,textarea,select,[contenteditable="true"],#language-switch'));
  const readingHelp=()=>host.open&&host.getClientRects().length>0;
  const controller=attachGamepad({...options,
    isEnabled:()=>!typing()&&!readingHelp()&&options.isEnabled(),
    canPause:()=>!typing()&&!readingHelp()&&Boolean(options.canPause?.()),
    onStatus:value=>{latest=value;render();options.onStatus?.(value);},
  });
  render();window.addEventListener('unseen-language-change',render);
  window.addEventListener('pagehide',event=>{if(event.persisted)controller.reset();else{controller.destroy();window.removeEventListener('unseen-language-change',render);}});
  return controller;
}
