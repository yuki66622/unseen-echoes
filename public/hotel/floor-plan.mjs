import {translate} from '../locale-core.mjs';
import {DOORS} from './world.mjs';

const ROOMS = [
  {floor:0,x:5,y:3,label:'Reception'}, {floor:0,x:14,y:2,label:'Lounge'},
  {floor:0,x:11,y:-1.8,label:'Outside'},
  {floor:1,x:6,y:5.8,label:'Recording room'}, {floor:1,x:15,y:4,label:'Linen room'},
  {floor:1,x:7,y:10.2,label:'Corridor'},
];
// Only actual hotel landmarks are eligible. Never enumerate arbitrary sources:
// chase targets, motors and other player positions do not belong on this map.
const LANDMARKS = [
  {id:'martin',label:'Martin',dx:8,dy:-8},
  {id:'claire',label:'Claire',dx:-8,dy:-9,align:'right'},
  {id:'elena',label:'Elena',dx:8,dy:15},
  {id:'cleaner',label:'Cleaner',dx:-8,dy:-10,align:'right'},
  {id:'cart',label:'Cart',dx:8,dy:17},
  {id:'recorder',label:'Recorder',dx:8,dy:4},
];

export function drawFloorPlan(ctx,{scene,floor,walls,door,mapDoors=[],bounds,doors,sources,X,Y,scale,pixelScale}) {
  const markers=[];
  ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.lineCap='round';ctx.lineJoin='round';
  if(scene!=='hotel'){
    // Grid and outer edge describe the open field, not physical interior walls.
    ctx.strokeStyle='#213040';ctx.lineWidth=Math.max(.5,.45*pixelScale);
    ctx.beginPath();
    for(let n=1;n<bounds.width;n++){ctx.moveTo(X(n),Y(0));ctx.lineTo(X(n),Y(bounds.height));}
    for(let n=1;n<bounds.height;n++){ctx.moveTo(X(0),Y(n));ctx.lineTo(X(bounds.width),Y(n));}
    ctx.stroke();ctx.strokeStyle='#7f94af';ctx.lineWidth=1.2*pixelScale;
    ctx.beginPath();ctx.moveTo(X(0),Y(0));ctx.lineTo(X(bounds.width),Y(0));ctx.lineTo(X(bounds.width),Y(bounds.height));ctx.lineTo(X(0),Y(bounds.height));ctx.closePath();ctx.stroke();
    if(scene==='tutorial'||scene==='world'){
      ctx.beginPath();for(const w of walls){ctx.moveTo(X(w.x1),Y(w.y1));ctx.lineTo(X(w.x2),Y(w.y2));}ctx.stroke();
      for(const d of mapDoors){const open=doors[d.id]||0,angle=open*Math.PI/2,dx=d.b.x-d.a.x,dy=d.b.y-d.a.y;ctx.strokeStyle=open?'#7ca0b3':'#c1b393';ctx.lineWidth=2*pixelScale;ctx.beginPath();ctx.moveTo(X(d.a.x),Y(d.a.y));ctx.lineTo(X(d.a.x+dx*Math.cos(angle)-dy*Math.sin(angle)),Y(d.a.y+dx*Math.sin(angle)+dy*Math.cos(angle)));ctx.stroke();}
      if(door){const angle=(doors.main||0)*Math.PI/2,dx=door.b.x-door.a.x,dy=door.b.y-door.a.y;ctx.strokeStyle=doors.main?'#7ca0b3':'#c1b393';ctx.lineWidth=2*pixelScale;ctx.beginPath();ctx.moveTo(X(door.a.x),Y(door.a.y));ctx.lineTo(X(door.a.x+dx*Math.cos(angle)-dy*Math.sin(angle)),Y(door.a.y+dx*Math.sin(angle)+dy*Math.cos(angle)));ctx.stroke();}
    }
    return markers;
  }

  ctx.strokeStyle='#7f94af';ctx.lineWidth=Math.max(1,1.2*pixelScale);
  ctx.beginPath();
  for(const w of walls){if(w.floor!==floor)continue;ctx.moveTo(X(w.x1),Y(w.y1));ctx.lineTo(X(w.x2),Y(w.y2));}
  ctx.stroke();
  ctx.font=`400 ${11*pixelScale}px "Times New Roman", "PingFang SC", serif`;ctx.textAlign='center';ctx.fillStyle='#77889d';
  for(const room of ROOMS){if(room.floor===floor)ctx.fillText(translate(room.label),X(room.x),Y(room.y));}

  for(const [id,door] of Object.entries(DOORS)){
    if(door.floor!==floor)continue;
    const open=Math.max(0,Math.min(1,doors[id]||0)),w=door.wall,angle=open*Math.PI/2;
    const dx=w.x2-w.x1,dy=w.y2-w.y1;
    ctx.strokeStyle=open>.8?'#7ca0b3':'#c1b393';ctx.lineWidth=2*pixelScale;
    ctx.beginPath();ctx.moveTo(X(w.x1),Y(w.y1));
    ctx.lineTo(X(w.x1+dx*Math.cos(angle)-dy*Math.sin(angle)),Y(w.y1+dx*Math.sin(angle)+dy*Math.cos(angle)));ctx.stroke();
  }

  ctx.strokeStyle='#849bb5';ctx.lineWidth=1*pixelScale;
  ctx.beginPath();
  for(let n=0;n<6;n++){const y=8.7+n*.4;ctx.moveTo(X(15),Y(y));ctx.lineTo(X(17),Y(y));}
  ctx.stroke();ctx.textAlign='center';ctx.fillStyle='#9fb1c6';ctx.fillText(translate('Stairs'),X(16),Y(11.5));

  ctx.font=`400 ${11*pixelScale}px "Times New Roman", "PingFang SC", serif`;
  for(const item of LANDMARKS){
    const p=sources[item.id];
    if(!p||p.floor!==floor||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
    markers.push(item.id);ctx.fillStyle='#bbc7d6';
    if(item.id==='recorder'||item.id==='cart')ctx.fillRect(X(p.x)-2.4*pixelScale,Y(p.y)-2.4*pixelScale,4.8*pixelScale,4.8*pixelScale);
    else{ctx.beginPath();ctx.arc(X(p.x),Y(p.y),2.5*pixelScale,0,Math.PI*2);ctx.fill();}
    ctx.textAlign=item.align||'left';ctx.fillText(translate(item.label),X(p.x)+item.dx*pixelScale,Y(p.y)+item.dy*pixelScale);
  }
  return markers;
}
