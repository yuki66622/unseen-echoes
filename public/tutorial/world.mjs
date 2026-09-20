import {TARGET_SOUND} from './sound-catalog.mjs?v=rooms-v3';
import {INITIAL_PLAYER,LOCATIONS,canTravel,hasLineOfSight,isNearDoor,occupiesDoor} from './room-layout.mjs?v=rooms-v3';
export {ROOM_SIZE,INITIAL_PLAYER,LOCATIONS} from './room-layout.mjs?v=rooms-v3';

export const INTERACTION_RADIUS = 1.1;

export function createGame(seed = 42) {
  let value = seed >>> 0;
  const random = () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = Math.imul(value ^ (value >>> 15), value | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const assignment = ['rain','forest','fire'];
  for (let i=assignment.length-1;i>0;i--) {const j=Math.floor(random()*(i+1)); [assignment[i],assignment[j]]=[assignment[j],assignment[i]];}
  return {seed:seed>>>0, player:{...INITIAL_PLAYER}, stage:'ready', attempts:0, checked:[], doorOpen:false,
    sources:LOCATIONS.map((p,i)=>({...p,soundId:assignment[i]})), route:[{...INITIAL_PLAYER}]};
}

export function move(game, forward, turn = 0) {
  if (game.stage !== 'explore') return false;
  const p = game.player;
  const heading = ((p.heading+turn)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
  const clamp = n => Math.min(7.6,Math.max(0.4,n));
  const candidate={heading,x:clamp(p.x+Math.sin(heading)*forward),y:clamp(p.y+Math.cos(heading)*forward)};
  const allowed=canTravel(p,candidate,game.doorOpen);
  game.player=allowed?candidate:{...p,heading};
  if (Math.hypot(game.player.x-p.x,game.player.y-p.y)>0.001) {
    game.route.push({x:game.player.x,y:game.player.y});
    if(game.route.length>2000) game.route.splice(1,1);
  }
  return allowed;
}

export function nearbySource(game) {
  if(game.stage !== 'explore') return null;
  return game.sources.find(s=>Math.hypot(s.x-game.player.x,s.y-game.player.y)<=INTERACTION_RADIUS
    &&hasLineOfSight(game.player,s,game.doorOpen)) ?? null;
}

export function toggleDoor(game) {
  if(game.stage!=='explore')return 'inactive';
  if(!isNearDoor(game.player))return 'far';
  if(game.doorOpen&&occupiesDoor(game.player))return 'occupied';
  game.doorOpen=!game.doorOpen;
  return game.doorOpen?'opened':'closed';
}

export function confirmSource(game) {
  const source = nearbySource(game);
  if(!source) return {result:'far'};
  if(game.checked.includes(source.id)) return {result:'already',source};
  game.attempts++;
  if(source.soundId===TARGET_SOUND) {game.stage='won'; return {result:'won',source};}
  game.checked.push(source.id);
  return {result:'wrong',source};
}
