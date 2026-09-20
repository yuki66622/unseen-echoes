import {acousticScene} from './acoustics.mjs';
import {doorPosition} from './world.mjs';

const initial={martin:'MARTIN-INITIAL',claire:'CLAIRE-INITIAL',elena:'ELENA-INITIAL'};
const stairPortals={'stairs-lower':{x:16,y:8},'stairs-upper':{x:14,y:10}};

/** A route to outstanding sound evidence, through doorways rather than walls. */
export function navigationGoal(state,collected,recordingHeard){
  if(state.stairs||state.phase==='ending')return null;
  let ids=Object.keys(initial).filter(id=>!collected.has(initial[id]));
  if(!recordingHeard&&(state.player.floor===1||!ids.length))ids=['recorder'];
  if(!ids.length)return null;
  const candidates=ids.map(id=>({id,source:state.sources[id],path:acousticScene(state,state.sources[id])}));
  candidates.sort((a,b)=>a.path.distance-b.path.distance);
  const {id,source,path}=candidates[0];
  const portal=path.route[0],point=doorPosition(portal)||stairPortals[portal]||source;
  const aim=Math.hypot(point.x-state.player.x,point.y-state.player.y)<.08?source:point;
  const angle=Math.atan2(aim.x-state.player.x,aim.y-state.player.y)-state.player.heading;
  return {id,distance:path.distance,bearing:Math.atan2(Math.sin(angle),Math.cos(angle)),via:portal||null};
}

/** Ten seconds without meaningful progress produces a two-second visual cue. */
export class NavigationHint{
  constructor(){this.reset();}
  reset(){this.goal=null;this.best=Infinity;this.stalled=0;this.remaining=0;this.lastPlayer=null;}
  update({goal,player,dt,active}){
    if(!active||!goal||goal.distance<=1.6){this.reset();return null;}
    if(goal.id!==this.goal){this.reset();this.goal=goal.id;this.best=goal.distance;}
    const moved=this.lastPlayer&&Math.hypot(player.x-this.lastPlayer.x,player.y-this.lastPlayer.y)>.005;
    if(moved&&goal.distance<this.best-.12){this.best=goal.distance;this.stalled=0;}
    this.lastPlayer={x:player.x,y:player.y};
    if(this.remaining>0)this.remaining=Math.max(0,this.remaining-dt-1e-10);
    else{
      this.stalled+=dt;
      if(this.stalled>=10-1e-7){this.remaining=2;this.stalled=0;}
    }
    return this.remaining>0?{bearing:goal.bearing,secondsLeft:this.remaining}:null;
  }
}
