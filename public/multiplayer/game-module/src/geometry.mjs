// Chase-only square-v1 geometry. Tutorial geometry remains in the parent engine.
export const ROOM_SIZE = 8;
export const PLAYER_RADIUS = 0.18;
export const LOCATIONS = Object.freeze([
  {id:'a',x:1.5,y:4.8}, {id:'b',x:7.6,y:5.5}, {id:'c',x:2,y:7}
]);
export const WALLS = Object.freeze([]); // No interior walls.
const BOUNDARY = Object.freeze([
  {a:{x:0,y:0},b:{x:8,y:0}}, {a:{x:8,y:0},b:{x:8,y:8}},
  {a:{x:8,y:8},b:{x:0,y:8}}, {a:{x:0,y:8},b:{x:0,y:0}},
]);
// The interactable point is just inside the east wall. Opening the exit enables
// escape interaction; movement remains inside the room even while it is open.
export const DOOR = Object.freeze({id:'main',a:{x:8,y:4.7},b:{x:8,y:6.3},
  center:{x:7.6,y:5.5},nearRadius:1.25,rearmRadius:1.8});
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export function pointSegmentDistance(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function inside(point,margin=0) {
  return Number.isFinite(point?.x)&&Number.isFinite(point?.y)
    &&point.x>=margin&&point.y>=margin&&point.x<=ROOM_SIZE-margin&&point.y<=ROOM_SIZE-margin;
}
export function blockingSegments(_doorOpen=false) { return BOUNDARY; }
export function canTravel(from,to,_doorOpen=false) {
  // A line between two valid points stays inside this convex empty room.
  return inside(from,PLAYER_RADIUS)&&inside(to,PLAYER_RADIUS);
}
export function hasLineOfSight(from,to,_doorOpen=false) {
  return inside(from)&&inside(to);
}
export const isNearDoor = player => distance(player,DOOR.center)<=DOOR.nearRadius;
export const occupiesDoor = player => pointSegmentDistance(player,DOOR.a,DOOR.b)<=PLAYER_RADIUS+0.08;
