/** Short, collision-safe paths for the companion. Planning never changes the world. */
import {acousticScene,roomAt} from './acoustics.mjs';
import {WALLS,PLAYER_RADIUS,doorPosition} from './world.mjs';

const GRID=.2;
const CLEARANCE=PLAYER_RADIUS+.002;
const PASSABLE=.92;
const DOOR_WALLS={
  entrance:{floor:0,x1:4.3,y1:0,x2:5.7,y2:0},
  lounge:{floor:0,x1:10,y1:3.9,x2:10,y2:5.3},
  recording:{floor:1,x1:2.3,y1:8,x2:3.7,y2:8},
  linen:{floor:1,x1:12.2,y1:8,x2:13.6,y2:8},
};
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function wallDistance(p,w){
  const dx=w.x2-w.x1,dy=w.y2-w.y1;
  const t=Math.max(0,Math.min(1,((p.x-w.x1)*dx+(p.y-w.y1)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-w.x1-t*dx,p.y-w.y1-t*dy);
}

function destination(state,goal){
  const source=state.sources?.[goal.id];
  if(!source||![source.x,source.y,source.floor].every(Number.isFinite)||![0,1].includes(source.floor)||source.x<0||source.x>18||source.y<(source.floor===0?-3:0)||source.y>12)return null;
  const route=acousticScene(state,source).route;
  for(const id of route){
    const door=doorPosition(id);
    if(door&&door.floor===state.player.floor&&(state.doors[id]<PASSABLE||state.doorTargets?.[id]===0)){
      return {point:door,radius:1.05,reason:'door'};
    }
    if(id.startsWith('stairs-')){
      // Stop outside the automatic trigger; the player makes the stair decision.
      return {point:state.player.floor===0?{x:16,y:7.9}:{x:13.9,y:10},radius:.035,reason:'stairs'};
    }
  }
  return source.floor===state.player.floor?{point:source,radius:1,reason:'target',room:roomAt(source)}:null;
}

class MinHeap{
  constructor(){this.items=[];}
  push(value){
    let index=this.items.push(value)-1;
    while(index){const parent=(index-1)>>1;if(this.items[parent].score<=value.score)break;this.items[index]=this.items[parent];index=parent;}
    this.items[index]=value;
  }
  pop(){
    const first=this.items[0],last=this.items.pop();
    if(this.items.length){
      let index=0;
      while(index*2+1<this.items.length){
        let child=index*2+1;if(child+1<this.items.length&&this.items[child+1].score<this.items[child].score)child++;
        if(this.items[child].score>=last.score)break;
        this.items[index]=this.items[child];index=child;
      }
      this.items[index]=last;
    }
    return first;
  }
}

/**
 * Return waypoints after the current pose, totalling at most maxDistance metres.
 * An empty door/target/stairs plan means already there; blocked means no safe path.
 * The caller uses queueTurn/queueMove sequentially and may cancel at any moment.
 */
export function planAssistance(state,goal,maxDistance=2){
  const empty=reason=>({points:[],distance:0,stopReason:reason,goalId:goal?.id||''});
  if(!goal||!state?.player||state.stairs||state.paused||state.phase==='ending')return empty('blocked');
  if(!Number.isFinite(maxDistance)||maxDistance<=0)return empty('limit');
  const start={x:state.player.x,y:state.player.y},floor=state.player.floor;
  if(![start.x,start.y,floor].every(Number.isFinite)||![0,1].includes(floor))return empty('blocked');
  const target=destination(state,goal);
  if(!target)return empty('blocked');
  const walls=[...WALLS.filter(w=>w.floor===floor),...Object.entries(DOOR_WALLS)
    .filter(([id,w])=>w.floor===floor&&(state.doors[id]<PASSABLE||state.doorTargets?.[id]===0)).map(([,w])=>w)];
  const inBounds=p=>p.x>=PLAYER_RADIUS&&p.x<=18-PLAYER_RADIUS&&p.y>=(floor===0?-3:0)+PLAYER_RADIUS&&p.y<=12-PLAYER_RADIUS;
  const inStairs=p=>floor===0?(p.x>=14&&p.y>=8.19):(p.x>=14.19&&p.y>=8);
  const clear=p=>inBounds(p)&&!inStairs(p)&&walls.every(w=>wallDistance(p,w)>=CLEARANCE);
  const safeLine=(a,b)=>{
    const steps=Math.max(1,Math.ceil(gap(a,b)/.025));
    // The current pose can touch the exact collision boundary; permit escape.
    for(let i=1;i<=steps;i++)if(!clear({x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps}))return false;
    return true;
  };
  const arrived=p=>gap(p,target.point)<=target.radius+1e-8&&(!target.room||roomAt({...p,floor})===target.room)&&
    (target.reason!=='target'||safeLine(p,target.point));
  if(arrived(start))return empty(target.reason);
  if(!inBounds(start)||walls.some(w=>wallDistance(start,w)<PLAYER_RADIUS-1e-7))return empty('blocked');

  // A virtual start joins a regular 20 cm grid. Grid corners cannot cut walls:
  // every edge and every later simplification is checked for the player's body.
  const width=91,height=floor===0?76:61,yMin=floor===0?-3:0;
  const point=index=>({x:(index%width)*GRID,y:yMin+Math.floor(index/width)*GRID});
  const valid=new Map(),parents=new Map(),costs=new Map(),heap=new MinHeap();
  const free=index=>{if(!valid.has(index))valid.set(index,clear(point(index)));return valid.get(index);};
  const heuristic=p=>Math.max(0,gap(p,target.point)-target.radius);
  const sx=Math.round(start.x/GRID),sy=Math.round((start.y-yMin)/GRID);
  for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
    const x=sx+ox,y=sy+oy,index=y*width+x;
    if(x<0||x>=width||y<0||y>=height||!free(index))continue;
    const p=point(index);if(!safeLine(start,p))continue;
    const cost=gap(start,p);costs.set(index,cost);parents.set(index,-1);heap.push({index,cost,score:cost+heuristic(p)});
  }
  let finish=null,finishPoint=null;
  while(heap.items.length){
    const current=heap.pop();if(current.cost!==costs.get(current.index))continue;
    const p=point(current.index);
    if(arrived(p)){finish=current.index;finishPoint=p;break;}
    // Stair approaches need not fall on the grid. This final short connector
    // also gives exact stopping points for an otherwise grid-free room.
    if(gap(p,target.point)<GRID*1.6&&clear(target.point)&&safeLine(p,target.point)){
      finish=current.index;finishPoint={x:target.point.x,y:target.point.y};break;
    }
    const x=current.index%width,y=Math.floor(current.index/width);
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      if(!ox&&!oy)continue;
      const nx=x+ox,ny=y+oy,next=ny*width+nx;
      if(nx<0||nx>=width||ny<0||ny>=height||!free(next))continue;
      const q=point(next),cost=current.cost+gap(p,q);
      if(cost>= (costs.get(next)??Infinity)-1e-10||!safeLine(p,q))continue;
      costs.set(next,cost);parents.set(next,current.index);heap.push({index:next,cost,score:cost+heuristic(q)});
    }
  }
  if(finish===null)return empty('blocked');
  const raw=[];
  for(let index=finish;index!==-1;index=parents.get(index))raw.push(point(index));
  raw.reverse();if(gap(raw.at(-1),finishPoint)>1e-8)raw.push(finishPoint);
  // Remove the grid's tiny zig-zags so movement is a few natural turns.
  const smooth=[];let previous=start,index=0;
  while(index<raw.length){
    let far=index;
    for(let next=raw.length-1;next>index;next--)if(safeLine(previous,raw[next])){far=next;break;}
    if(gap(previous,raw[far])>1e-8)smooth.push(raw[far]);
    previous=raw[far];index=far+1;
  }
  const points=[];let travelled=0;previous=start;
  for(const next of smooth){
    const length=gap(previous,next),remaining=maxDistance-travelled;
    if(length>remaining+1e-8){
      if(remaining>1e-8)points.push({x:previous.x+(next.x-previous.x)*remaining/length,y:previous.y+(next.y-previous.y)*remaining/length});
      return {points,distance:maxDistance,stopReason:'limit',goalId:goal.id};
    }
    points.push({...next});travelled+=length;previous=next;
  }
  return {points,distance:travelled,stopReason:target.reason,goalId:goal.id};
}
