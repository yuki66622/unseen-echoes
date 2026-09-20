import {move} from './world.mjs?v=rooms-v3';

export const WALK_METRES_PER_SECOND = 1;
export const TURN_RADIANS_PER_SECOND = Math.PI * 2 / 3;
const ease = progress => progress * progress * (3 - 2 * progress);

// The real player moves along the path. No separate visual-only interpolation:
// collisions, interactions and audio all consume this same evolving pose.
export class SmoothMovement {
  constructor({getGame,onUpdate=()=>{},requestFrame=callback=>requestAnimationFrame(callback),
    cancelFrame=id=>cancelAnimationFrame(id),now=()=>performance.now()}) {
    Object.assign(this,{getGame,onUpdate,requestFrame,cancelFrame,now});
    this.active=null;this.frame=null;
  }
  start({forward=0,turn=0,action='',onComplete=()=>{}}) {
    if (![forward,turn].every(Number.isFinite) || (!forward&&!turn) || (forward&&turn)) return false;
    this.cancel();
    const game=this.getGame();
    if(game.stage!=='explore')return false;
    const duration=1000*(Math.abs(forward)/WALK_METRES_PER_SECOND+Math.abs(turn)/TURN_RADIANS_PER_SECOND);
    const operation={game,forward,turn,action,onComplete,duration,elapsed:0,last:this.now(),progress:0,travelled:0,turned:0,frames:0};
    this.active=operation;
    this.frame=this.requestFrame(time=>this.tick(operation,time));
    return true;
  }
  tick(operation,time) {
    if(this.active!==operation)return;
    this.frame=null;
    if(this.getGame()!==operation.game||operation.game.stage!=='explore')return this.finish(operation,'cancelled');
    // A stalled frame never catches up by jumping across the room.
    const delta=Math.min(50,Math.max(0,time-operation.last));operation.last=time;
    operation.elapsed=Math.min(operation.duration,operation.elapsed+delta);
    const next=ease(operation.elapsed/operation.duration),fraction=next-operation.progress;
    const before={...operation.game.player},forward=operation.forward*fraction,turn=operation.turn*fraction;
    const allowed=move(operation.game,forward,turn);
    const travelled=Math.hypot(operation.game.player.x-before.x,operation.game.player.y-before.y);
    operation.travelled+=travelled;operation.turned+=turn;operation.frames++;operation.progress=next;
    this.onUpdate({elapsed:operation.elapsed,duration:operation.duration,pose:{...operation.game.player}});
    if(this.active!==operation)return;
    if(!allowed||(forward&&travelled+1e-7<Math.abs(forward)))return this.finish(operation,'blocked');
    if(operation.elapsed>=operation.duration)return this.finish(operation,'completed');
    this.frame=this.requestFrame(nextTime=>this.tick(operation,nextTime));
  }
  finish(operation,status) {
    if(this.active!==operation)return;
    if(this.frame!==null)this.cancelFrame(this.frame);
    this.frame=null;this.active=null;
    operation.onComplete({status,travelled:operation.travelled,turned:operation.turned,frames:operation.frames,elapsed:operation.elapsed});
  }
  cancel() { if(this.active)this.finish(this.active,'cancelled'); }
}
