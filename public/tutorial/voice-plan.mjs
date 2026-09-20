// The model understands language. This module validates capabilities, not phrases.
import {DOOR,distance,isNearDoor,insideRoom} from './room-layout.mjs?v=rooms-v3';
import {nearbySource} from './world.mjs?v=rooms-v3';

export function validateVoicePlan(value){
  if(!value||typeof value!=='object'||!['act','reply','clarify'].includes(value.mode)
    ||typeof value.text!=='string'||value.text.length>1000
    ||typeof value.message!=='string'||!value.message.trim()||value.message.length>400
    ||!Array.isArray(value.actions)||value.actions.length>4
    ||(value.mode==='act')!==Boolean(value.actions.length))throw new Error('模型返回的动作计划无效，本次未执行。');
  let total=0;
  for(const [i,a] of value.actions.entries()){
    if(!a||typeof a!=='object'||Object.keys(a).sort().join(',')!=='amount,state,type'
      ||!['move','turn','door','approachDoor','confirm','pause','stop'].includes(a.type)
      ||typeof a.amount!=='number'||!Number.isFinite(a.amount))throw new Error('动作格式无效，本次未执行。');
    if(a.type==='door'?!['open','close'].includes(a.state)||a.amount!==0:a.state!=='none')throw new Error('动作状态无效，本次未执行。');
    if(['move','approachDoor'].includes(a.type)){
      if(Math.abs(a.amount)<0.1||Math.abs(a.amount)>1||(a.type==='approachDoor'&&a.amount<0))throw new Error('移动距离超出范围，本次未执行。');
      total+=Math.abs(a.amount);
    }else if(a.type==='turn'){
      if(Math.abs(a.amount)<1||Math.abs(a.amount)>180)throw new Error('转身角度超出范围，本次未执行。');
    }else if(a.amount!==0)throw new Error('动作参数无效，本次未执行。');
    if(['pause','stop'].includes(a.type)&&i!==value.actions.length-1)throw new Error('停止后不能继续执行其他动作。');
  }
  if(total>1.5||(value.actions.length&&!value.text.trim()))throw new Error('这次动作过长或没有听到有效内容，本次未执行。');
  return {text:value.text,mode:value.mode,message:value.message,actions:value.actions.map(a=>({...a}))};
}

export function publicGameContext(game){
  const p=game.player;
  const bearing=Math.atan2(DOOR.center.x-p.x,DOOR.center.y-p.y);
  const angle=((bearing-p.heading+Math.PI*3)%(Math.PI*2)-Math.PI)*180/Math.PI;
  return {position:{x:p.x,y:p.y,heading:p.heading*180/Math.PI},
    inRoom:insideRoom(p),nearSound:Boolean(nearbySource(game)),checkedCount:game.checked.length,
    door:{open:game.doorOpen,nearby:isNearDoor(p),distance:distance(p,DOOR.center),relativeBearing:angle}};
}

export function doorApproach(game,maxMetres){
  const context=publicGameContext(game);
  return {degrees:context.door.relativeBearing,metres:Math.max(0,Math.min(maxMetres,context.door.distance-0.75))};
}

export async function executeVoicePlan(plan,{perform,isCurrent=()=>true,onProgress=()=>{}}){
  const verified=validateVoicePlan(plan),results=[];
  for(const [index,action] of verified.actions.entries()){
    if(!isCurrent())return {status:'cancelled',results};
    onProgress(index,verified.actions.length,action);
    const result=await perform(action);
    results.push(result);
    if(!isCurrent())return {status:'cancelled',results};
    if(result.status!=='completed')return {status:result.status,results};
  }
  return {status:'completed',results};
}
