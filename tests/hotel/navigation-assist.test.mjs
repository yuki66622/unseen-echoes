import test from 'node:test';
import assert from 'node:assert/strict';
import {planAssistance} from '../../public/hotel/navigation-assist.mjs';
import {createState,queueTurn,queueMove,updateWorld,nearestDoor,nearestInteraction,regionAt} from '../../public/hotel/world.mjs';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const delta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
function position(state,x,y,floor=0,heading=0){Object.assign(state.player,{x,y,floor,heading});state.region=regionAt(state.player);}
function open(state,id){state.doors[id]=1;state.doorTargets[id]=1;}
function assertBounded(state,plan,budget=2){
  let p=state.player,length=0;
  for(const q of plan.points){assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.y));length+=distance(p,q);p=q;}
  assert.ok(length<=budget+1e-7,`${length} exceeds ${budget}`);
  assert.ok(Math.abs(length-plan.distance)<1e-7);
}
function replay(state,plan){
  const events=[];
  for(const waypoint of plan.points){
    let remaining=distance(state.player,waypoint);
    const heading=Math.atan2(waypoint.x-state.player.x,waypoint.y-state.player.y);
    for(let i=0;i<4&&Math.abs(delta(state.player.heading,heading))>1e-8;i++){
      assert.ok(queueTurn(state,delta(state.player.heading,heading)*180/Math.PI));
      events.push(...updateWorld(state,.8));
    }
    assert.ok(Math.abs(delta(state.player.heading,heading))<1e-7);
    for(let i=0;i<100&&remaining>1e-7;i++){
      assert.ok(queueMove(state,Math.min(remaining,1)));
      events.push(...updateWorld(state,.8));
      assert.equal(state.stairs,null,'assistance must never trigger automatic stairs');
      assert.equal(events.some(e=>e.type==='collision'),false,`collision on route to ${JSON.stringify(waypoint)}`);
      remaining=distance(state.player,waypoint);
    }
    assert.ok(remaining<1e-6,'all points are physically reachable');
  }
  return events;
}

test('spawn approaches a closed entrance, never opens it and leaves state untouched',()=>{
  const state=createState(),before=structuredClone(state);
  const plan=planAssistance(state,{id:'martin'});
  assert.deepEqual(state,before);
  assertBounded(state,plan);
  assert.equal(plan.stopReason,'door');assert.equal(plan.goalId,'martin');assert.ok(plan.distance>.3);
  replay(state,plan);
  assert.equal(nearestDoor(state)?.id,'entrance');
  assert.ok(distance(state.player,{x:5,y:0})<=1.05+1e-7);
  assert.equal(state.doors.entrance,0);assert.ok(state.player.y<0);
});

test('bounded plans use open doorways and finish within source interaction range',()=>{
  const state=createState();open(state,'entrance');
  for(let i=0;i<10;i++){
    const plan=planAssistance(state,{id:'martin'});assertBounded(state,plan);replay(state,plan);
    if(plan.stopReason==='target')break;
    assert.equal(plan.stopReason,'limit');assert.ok(plan.distance>1.99);
  }
  assert.equal(nearestInteraction(state)?.id,'martin');
  assert.ok(distance(state.player,state.sources.martin)<=1.25+1e-7);
});

test('routes around awkward wall corners instead of following a direct bearing through walls',()=>{
  const state=createState();position(state,.2,-2.8,0,Math.PI);open(state,'entrance');open(state,'lounge');
  const plan=planAssistance(state,{id:'elena'},40);assertBounded(state,plan,40);
  assert.equal(plan.stopReason,'target');assert.ok(plan.points.length>=3);
  replay(state,plan);
  assert.equal(nearestInteraction(state)?.id,'elena');
});

test('wall-contact start can escape and approach a door without returning an unnecessary empty path',()=>{
  const state=createState();position(state,9.82,9.8,0,Math.PI/2);
  const plan=planAssistance(state,{id:'claire'},20);assertBounded(state,plan,20);
  assert.equal(plan.stopReason,'door');assert.ok(plan.distance>3);
  replay(state,plan);assert.equal(nearestDoor(state)?.id,'lounge');
  const threshold=createState();position(threshold,8.45,4.6);
  const small=planAssistance(threshold,{id:'claire'});
  assert.ok(small.distance>.3);replay(threshold,small);assert.equal(nearestDoor(threshold)?.id,'lounge');
});

test('downstairs cross-floor guidance ends before stair trigger and keeps the current floor',()=>{
  const state=createState();position(state,12,6,0,Math.PI);open(state,'lounge');
  const plan=planAssistance(state,{id:'recorder'},20);assertBounded(state,plan,20);
  assert.equal(plan.stopReason,'stairs');replay(state,plan);
  assert.equal(state.player.floor,0);assert.equal(state.stairs,null);
  assert.ok(distance(state.player,{x:16,y:7.9})<.04);
});

test('upstairs guidance takes an open room exit and stops before the descending stair trigger',()=>{
  const state=createState();position(state,10,4,1,Math.PI);open(state,'recording');
  const plan=planAssistance(state,{id:'elena'},30);assertBounded(state,plan,30);
  assert.equal(plan.stopReason,'stairs');replay(state,plan);
  assert.equal(state.player.floor,1);assert.equal(state.stairs,null);
  assert.ok(distance(state.player,{x:13.9,y:10})<.04);
});

test('closed room door takes precedence over stairs, and closing doors stay impassable',()=>{
  const state=createState();position(state,7,4,1);
  const plan=planAssistance(state,{id:'martin'},20);assert.equal(plan.stopReason,'door');replay(state,plan);
  assert.equal(nearestDoor(state)?.id,'recording');assert.equal(state.player.floor,1);
  const closing=createState();position(closing,8,4.6);closing.doors.lounge=1;closing.doorTargets.lounge=0;
  const cautious=planAssistance(closing,{id:'claire'});assert.equal(cautious.stopReason,'door');replay(closing,cautious);
  assert.equal(regionAt(closing.player),'lobby');
});

test('small distance budgets count every turn of a corner, not straight-line displacement',()=>{
  const state=createState();position(state,8.9,5.9);open(state,'lounge');
  const plan=planAssistance(state,{id:'claire'},1.75);assertBounded(state,plan,1.75);
  assert.equal(plan.stopReason,'limit');assert.ok(plan.points.length>=2);replay(state,plan);
});

test('near targets, paused/stair/ending states and invalid or disconnected inputs do not move',()=>{
  const near=createState();position(near,4,7);assert.deepEqual(planAssistance(near,{id:'martin'}),{points:[],distance:0,stopReason:'target',goalId:'martin'});
  const closed=createState();position(closed,5,-.8);assert.equal(planAssistance(closed,{id:'martin'}).stopReason,'door');
  for(const value of [0,-1,NaN,Infinity])assert.equal(planAssistance(createState(),{id:'martin'},value).points.length,0);
  for(const change of [{paused:true},{stairs:{}},{phase:'ending'}]){
    const state=Object.assign(createState(),change);assert.equal(planAssistance(state,{id:'martin'}).stopReason,'blocked');
  }
  const outside=createState();outside.sources.martin.x=22;
  assert.equal(planAssistance(outside,{id:'missing'}).stopReason,'blocked');
  open(outside,'entrance');assert.equal(planAssistance(outside,{id:'martin'}).stopReason,'blocked');
});

test('boundary-pose sweep replays across every room with closed and open doors without a wall or stair event',()=>{
  const poses=[
    [0,.2,-2.8],[0,17.8,-2.8],[0,.2,.2],[0,9.8,11.8],
    [0,10.2,.2],[0,13.8,11.8],[0,17.8,7.8],[0,15.5,7.8],
    [1,.2,.2],[1,11.8,7.8],[1,12.2,.2],[1,17.8,7.8],
    [1,.2,11.8],[1,13.8,10.8],[1,13.8,9.2],[1,13.8,8.2],
  ];
  for(const [floor,x,y] of poses)for(const allOpen of [false,true])for(const id of ['martin','claire','recorder']){
    const state=createState();position(state,x,y,floor,Math.PI);
    if(allOpen)for(const door of Object.keys(state.doors))open(state,door);
    const plan=planAssistance(state,{id},40);
    assertBounded(state,plan,40);
    assert.notEqual(plan.stopReason,'blocked',`unexpected block at ${floor}:${x},${y}, open=${allOpen}, goal=${id}`);
    const originalFloor=state.player.floor;
    replay(state,plan);assert.equal(state.player.floor,originalFloor);
  }
});
