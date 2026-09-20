import {acousticScene} from './acoustics.mjs';
import {doorPosition} from './world.mjs';

const initial={martin:'MARTIN-INITIAL',claire:'CLAIRE-INITIAL',elena:'ELENA-INITIAL'};
const stairPortals={'stairs-lower':{x:16,y:8},'stairs-upper':{x:14,y:10}};

/** Bearing is relative to the player's nose: positive means their right. */
export function relativeDirection(bearing){
  const angle=Math.atan2(Math.sin(bearing),Math.cos(bearing))*180/Math.PI;
  const directions=['Ahead','Ahead to your right','To your right','Behind to your right','Behind you','Behind to your left','To your left','Ahead to your left'];
  return directions[(Math.round(angle/45)+8)%8];
}

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
  reset(){this.goal=null;this.approach=0;this.lastDistance=null;this.stalled=0;this.lostSeconds=0;this.remaining=0;this.lastPlayer=null;}
  update({goal,player,dt,active}){
    if(!active||!goal||goal.distance<=1.6){this.reset();return null;}
    if(goal.id!==this.goal){this.reset();this.goal=goal.id;}
    const dx=this.lastPlayer?player.x-this.lastPlayer.x:0,dy=this.lastPlayer?player.y-this.lastPlayer.y:0;
    const moved=Math.hypot(dx,dy),closer=this.lastDistance===null?0:this.lastDistance-goal.distance;
    const aim=goal.bearing+(player.heading||0),toward=dx*Math.sin(aim)+dy*Math.cos(aim);
    // Count recent recovery too: returning after a wrong turn is real progress.
    // A source moving toward a stationary player cannot reset their timer.
    if(moved>1e-5){
      if(closer>0&&toward>0)this.approach+=Math.min(closer,toward);
      else this.approach=0;
      if(this.approach>=.12){this.approach=0;this.stalled=0;this.lostSeconds=0;}
    }
    this.lastDistance=goal.distance;
    this.lastPlayer={x:player.x,y:player.y};
    this.lostSeconds+=dt;
    if(this.remaining>0)this.remaining=Math.max(0,this.remaining-dt-1e-10);
    else{
      this.stalled+=dt;
      if(this.stalled>=10-1e-7){this.remaining=2;this.stalled=0;}
    }
    return this.remaining>0?{bearing:goal.bearing,secondsLeft:this.remaining}:null;
  }
}
