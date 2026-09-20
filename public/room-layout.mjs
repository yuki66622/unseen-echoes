export const ROOM_SIZE = 8;
export const PLAYER_RADIUS = 0.18;
export const INITIAL_PLAYER = Object.freeze({x:2,y:1,heading:0});
export const LOCATIONS = Object.freeze([
  {id:'a',x:1.5,y:4.8}, {id:'b',x:6.5,y:5.5}, {id:'c',x:2,y:7}
]);
export const WALLS = Object.freeze([
  {a:{x:4,y:3.5},b:{x:8,y:3.5}},
  {a:{x:4,y:3.5},b:{x:4,y:4.7}},
  {a:{x:4,y:6.3},b:{x:4,y:8}}
]);
export const DOOR = Object.freeze({id:'main',a:{x:4,y:4.7},b:{x:4,y:6.3},
  center:{x:4,y:5.5},nearRadius:1.25,rearmRadius:1.8});
const EPS = 1e-9;
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export const insideRoom = p => p.x>4 && p.y>3.5;

export function pointSegmentDistance(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function segmentDistance(a,b,c,d) {
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
  if(((ab1>EPS&&ab2< -EPS)||(ab1< -EPS&&ab2>EPS))
    &&((cd1>EPS&&cd2< -EPS)||(cd1< -EPS&&cd2>EPS)))return 0;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),
    pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
export function blockingSegments(doorOpen=false) { return doorOpen?WALLS:[...WALLS,DOOR]; }
export function canTravel(from,to,doorOpen=false) {
  return blockingSegments(doorOpen).every(w=>segmentDistance(from,to,w.a,w.b)>PLAYER_RADIUS-EPS);
}
export function hasLineOfSight(from,to,doorOpen=false) {
  return blockingSegments(doorOpen).every(w=>segmentDistance(from,to,w.a,w.b)>EPS);
}
export const isNearDoor = player => distance(player,DOOR.center)<=DOOR.nearRadius;
export const occupiesDoor = player => pointSegmentDistance(player,DOOR.a,DOOR.b)<=PLAYER_RADIUS+0.08;

// A small doorway/occlusion model, not a full room-impulse-response simulation.
export function getAcousticPath(listener,source,doorOpen=false) {
  if(hasLineOfSight(listener,source,doorOpen))return {gain:1,cutoff:18000,position:{x:source.x,y:source.y},kind:'direct'};
  if(doorOpen&&insideRoom(listener)!==insideRoom(source)
    &&hasLineOfSight(listener,DOOR.center,true)&&hasLineOfSight(DOOR.center,source,true)) {
    const first=distance(listener,DOOR.center),total=first+distance(source,DOOR.center);
    // Place a virtual source along the doorway direction at the total path length.
    const scale=first>0.001?total/first:1;
    return {gain:0.82,cutoff:8500,position:{x:listener.x+(DOOR.center.x-listener.x)*scale,
      y:listener.y+(DOOR.center.y-listener.y)*scale},kind:'doorway'};
  }
  return {gain:0.22,cutoff:650,position:{x:source.x,y:source.y},kind:'occluded'};
}
