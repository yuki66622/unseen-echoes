import {localizeMessage,roleLabel} from './i18n.mjs';

const $=id=>document.getElementById(id);
const scenes={rules:'lobby-rules',name:'lobby-name',choice:'lobby-choice',join:'lobby-join',room:'room-details'};
const rules=[
  ['下一扇门后，\n你不再独行。','两人进入同一个世界。\n一个追寻心跳，一个听脚步躲避。'],
  ['你要追寻，\n还是逃离？','监管者循着求生者的心跳接近，按 E 尝试抓捕。\n求生者听脚步躲避，找到电机后到雨声处按 E 逃脱。\n场地没有墙和门。'],
  ['等你们都准备好。','两人选择不同角色，再各自点击“准备开始”。\n当前测试场中，求生者先行 8 秒，一局限时 3 分钟。'],
];
const stored=(storage,key)=>{try{return globalThis[storage].getItem(key)||'';}catch{return '';}};
const remember=(storage,key,value)=>{try{globalThis[storage].setItem(key,value);}catch{/* Naming still works without storage. */}};
export function validPlayerName(raw){
  const name=String(raw||'').trim();
  return [...name].length>=1&&[...name].length<=32&&!/[\u0000-\u001f\u007f-\u009f]/u.test(name)?name:null;
}

export class LobbyFlow{
  constructor(actions){
    this.actions=actions;this.step='name';this.room=null;this.identity=null;this.ready=false;this.busy=false;this.ruleIndex=0;this.ruleReturn=null;
    this.name=validPlayerName(stored('localStorage','unseen-player-name'))||'';
    $('player-name').value=this.name;
    $('profile-form').addEventListener('submit',event=>{
      event.preventDefault();const name=validPlayerName($('player-name').value);
      if(!name){$('name-error').textContent='请输入 1 至 32 个字符的名字。';$('player-name').focus();return;}
      this.name=name;remember('localStorage','unseen-player-name',name);$('name-error').textContent='';this.go(this.invitedCode?'join':'choice');
    });
    $('player-name').addEventListener('input',()=>$('name-error').textContent='');
    $('change-name').addEventListener('click',()=>this.go('name'));
    $('show-join').addEventListener('click',()=>this.go('join'));
    $('lobby-back').addEventListener('click',()=>this.go('choice'));
    $('show-rules').addEventListener('click',()=>{this.ruleReturn=this.step;this.ruleIndex=0;this.go('rules');});
    $('rules-next').addEventListener('click',()=>{if(this.ruleIndex<rules.length-1){this.ruleIndex++;this.drawRules();}else this.finishRules();});
    $('rules-back').addEventListener('click',()=>{if(this.ruleIndex>0){this.ruleIndex--;this.drawRules();}});
    $('rules-skip').addEventListener('click',()=>this.finishRules());
    $('create-room').addEventListener('click',()=>this.perform(()=>actions.create(this.name)));
    $('join-form').addEventListener('submit',event=>{event.preventDefault();this.perform(()=>actions.join($('room-code').value.trim().toUpperCase(),this.name));});
    $('room-code').addEventListener('input',()=>{$('room-code').value=$('room-code').value.toUpperCase();$('room-code').setCustomValidity('');});
    $('room-code').addEventListener('invalid',()=>$('room-code').setCustomValidity('请输入朋友提供的 6 位英文字母或数字。'));
    document.querySelectorAll('[data-role]').forEach(button=>button.addEventListener('click',()=>this.perform(()=>actions.role(button.dataset.role))));
    $('ready').addEventListener('click',()=>this.perform(()=>actions.ready(!this.me()?.ready)));
    $('leave-room').addEventListener('click',()=>this.perform(()=>actions.leave()));
    $('retry-connection').addEventListener('click',()=>actions.retry());
    $('copy-room-code').addEventListener('click',()=>this.copyCode());
  }
  begin({skipRules=false}={}){
    if(this.room)return this.go('room');
    if(!skipRules&&!stored('sessionStorage','unseen-chase-rules-seen')){this.ruleReturn=null;this.ruleIndex=0;this.go('rules');}
    else this.go(this.name?(this.invitedCode?'join':'choice'):'name');
  }
  setInvitation(raw){
    const code=String(raw||'').toUpperCase();
    if(/^[A-Z0-9]{6}$/.test(code)){this.invitedCode=code;$('room-code').value=code;}
  }
  setInviteBase(base){this.inviteBase=base;$('copy-room-code').textContent=base?'复制邀请链接':'复制房间码';}
  go(step){
    this.step=step;for(const [key,id] of Object.entries(scenes))$(id).hidden=key!==step;
    $('lobby').dataset.step=step;$('profile-name').textContent=this.name;
    $('lobby-back').hidden=!['join'].includes(step)&&!(step==='name'&&this.name);
    $('show-rules').hidden=step==='rules';$('lobby-error').textContent='';
    if(step==='rules')this.drawRules();
    this.updateButtons();
  }
  drawRules(){
    $('rules-title').textContent=rules[this.ruleIndex][0];$('rules-body').textContent=rules[this.ruleIndex][1];
    $('rules-page').textContent=`${String(this.ruleIndex+1).padStart(2,'0')} / 03`;
    $('rules-back').disabled=this.ruleIndex===0;$('rules-next').textContent=this.ruleIndex===rules.length-1?'进入房间':'继续';
  }
  finishRules(){
    remember('sessionStorage','unseen-chase-rules-seen','1');
    const previous=this.ruleReturn==='room'?null:this.ruleReturn;
    this.go(this.room?'room':previous||(this.name?(this.invitedCode?'join':'choice'):'name'));this.ruleReturn=null;
  }
  me(){return this.room?.members.find(member=>member.identity===this.identity);}
  updateRoom(room,identity){
    const previous=this.room;this.room=room;this.identity=identity;
    if(!room){if(previous&&this.step==='room')this.go(this.name?'choice':'name');this.updateButtons();return;}
    if(this.step!=='room'&&this.step!=='rules')this.go('room');
    if($('active-code').textContent!==room.code){$('room-copy-fallback').hidden=true;$('room-share-status').textContent='';}
    $('active-code').textContent=room.code;$('room-code-copy').value=room.code;
    const me=this.me(),partner=room.members.find(member=>member.identity!==identity);
    if(me?.name){this.name=me.name;remember('localStorage','unseen-player-name',me.name);$('player-name').value=me.name;}
    const slots=[me,partner].map((member,index)=>{
      const li=document.createElement('li'),label=document.createElement('span'),name=document.createElement('strong'),state=document.createElement('span');
      label.className='member-label';label.textContent=index===0?'你':'同行的人';name.textContent=member?.name||'等待加入';state.className='member-state';
      state.textContent=!member?'把上方房间码发给朋友':!member.online?'暂时离线':`${roleLabel(member.role)} · ${member.ready?'已准备':'未准备'}`;
      li.append(label,name,state);return li;
    });$('roster').replaceChildren(...slots);
    $('room-title').textContent=partner?'你们都在这里。':'等一个同行的人。';
    $('ready-hint').textContent=!me?.role?'先选择你的角色。':!partner?'朋友加入后，双方准备即可开始。':!partner.online?'等待朋友重新连接。':!partner.role?'等待朋友选择另一个角色。':me.ready?'你已准备，等待朋友准备。':'双方都准备后，追逐就会开始。';
    this.updateButtons();
  }
  setConnection(message,{state,attempt=0,reason}={}){
    this.ready=state==='connected'||message==='已连接';
    const failed=state==='error'||state==='reconnecting'||attempt>0||/中断|失败|超时|重连|重新连接|无法连接/.test(message);
    $('connection').textContent=this.ready?(reason==='storage-unavailable'?message:'已连接'):message;
    $('lobby-connection').dataset.state=this.ready?'connected':failed?'error':'connecting';
    $('retry-connection').hidden=this.ready||!failed;$('connection-help').hidden=this.ready||!failed;
    this.updateButtons();
  }
  updateButtons(){
    $('create-room').disabled=!this.ready||this.busy||!this.name;$('join-room').disabled=!this.ready||this.busy||!this.name;
    const me=this.me(),partner=this.room?.members.find(member=>member.identity!==this.identity);
    document.querySelectorAll('[data-role]').forEach(button=>{
      const occupied=partner?.role===button.dataset.role;
      button.disabled=!this.ready||this.busy||occupied;button.setAttribute('aria-pressed',String(me?.role===button.dataset.role));
      button.title=occupied?'朋友已选择这个角色':'';
    });
    $('ready').disabled=!this.ready||this.busy||!me?.role;$('ready').textContent=me?.ready?'取消准备':'准备开始';
    $('leave-room').disabled=!this.ready||this.busy;
  }
  async perform(action){
    if(this.busy)return;if(!this.ready){this.error('还没有连接成功，请点击“重新连接”后重试。');return;}
    if(!this.name){this.go('name');return;}
    this.busy=true;$('lobby-error').textContent='';this.updateButtons();
    try{await action();}catch(error){this.error(localizeMessage(error.message));}finally{this.busy=false;this.updateButtons();}
  }
  error(message){$('lobby-error').textContent=message;}
  async copyCode(){
    if(!this.room)return;
    const invite=this.inviteBase?new URL(`/?room=${encodeURIComponent(this.room.code)}`,this.inviteBase).href:this.room.code;
    try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(invite);$('room-copy-fallback').hidden=true;$('room-share-status').textContent=this.inviteBase?'邀请链接已复制，朋友打开后输入名字即可加入。':'房间码已复制，发给朋友即可。';}
    catch{$('room-copy-fallback').hidden=false;$('room-code-copy').value=invite;$('room-code-copy').focus();$('room-code-copy').select();$('room-share-status').textContent='请复制已选中的邀请信息，发给朋友。';}
  }
}
