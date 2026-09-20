import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationHint,navigationGoal,relativeDirection} from '../../public/hotel/navigation-hint.mjs';
import {createState} from '../../public/hotel/world.mjs';
const update=(hint,seconds,extra={})=>{let result=null;for(let t=0;t<Math.round(seconds/.05);t++)result=hint.update({goal:{id:'martin',distance:8,bearing:0},player:{x:5,y:2},dt:.05,active:true,...extra});return result;};
test('ten stalled seconds reveal a direction for exactly two active seconds',()=>{
 const hint=new NavigationHint();assert.equal(update(hint,9.95),null);assert.ok(update(hint,.05));
 assert.ok(update(hint,1.95));assert.equal(update(hint,.05),null);assert.equal(update(hint,9.95),null);assert.ok(update(hint,.05));
});
test('real progress postpones a cue; turning or a source approaching does not fake progress',()=>{
 const hint=new NavigationHint();update(hint,9);
 const closer={goal:{id:'martin',distance:7.5,bearing:0},player:{x:5,y:2.5}};
 assert.equal(update(hint,.05,closer),null);assert.equal(update(hint,8,closer),null);
 hint.reset();update(hint,9);assert.ok(update(hint,1,{goal:{id:'martin',distance:7,bearing:1}}));
});
test('reading, pause, proximity and completed investigation suppress hints',()=>{
 const hint=new NavigationHint();update(hint,10);assert.equal(update(hint,.05,{active:false}),null);
 assert.equal(update(hint,9.95),null);assert.equal(update(hint,20,{goal:{id:'martin',distance:1.5,bearing:0}}),null);
 const state=createState();const all=new Set(['MARTIN-INITIAL','CLAIRE-INITIAL','ELENA-INITIAL']);assert.equal(navigationGoal(state,all,true),null);
});
test('directions follow entrance and room portals rather than pointing through a wall',()=>{
 const state=createState();let goal=navigationGoal(state,new Set(),false);assert.equal(goal.via,'entrance');assert.equal(goal.bearing,0);
 state.player={x:4,y:8,floor:0,heading:0};goal=navigationGoal(state,new Set(['MARTIN-INITIAL']),false);assert.equal(goal.via,'lounge');assert.ok(goal.bearing>Math.PI/2);
 state.player={x:12.4,y:9.5,floor:1,heading:0};goal=navigationGoal(state,new Set(),false);assert.equal(goal.id,'recorder');assert.equal(goal.via,'recording');assert.ok(goal.bearing<0);
});

test('direction descriptions use eight player-relative sectors, including wrapped angles',()=>{
 const expected=['Ahead','Ahead to your right','To your right','Behind to your right','Behind you','Behind to your left','To your left','Ahead to your left'];
 expected.forEach((text,index)=>assert.equal(relativeDirection(index*Math.PI/4),text));
 assert.equal(relativeDirection(-Math.PI/4),'Ahead to your left');
 assert.equal(relativeDirection(Math.PI*2),'Ahead');
 const state=createState();state.player.heading=Math.PI/2;
 assert.equal(relativeDirection(navigationGoal(state,new Set(),false).bearing),'To your left');
});
test('lost duration spans short hints but resets on real progress and excluded time',()=>{
 const hint=new NavigationHint();update(hint,30);assert.ok(hint.lostSeconds>=29.999);
 update(hint,.05,{player:{x:5,y:3},goal:{id:'martin',distance:6,bearing:0}});
 assert.ok(hint.lostSeconds<.1);update(hint,20);update(hint,1,{active:false});assert.equal(hint.lostSeconds,0);
});
test('returning toward the sound after backtracking counts as progress before passing the old best',()=>{
 const hint=new NavigationHint();
 update(hint,1,{player:{x:5,y:5},goal:{id:'martin',distance:5,bearing:0}});
 update(hint,20,{player:{x:5,y:2},goal:{id:'martin',distance:8,bearing:0}});
 assert.ok(hint.lostSeconds>=20);
 update(hint,.05,{player:{x:5,y:2.5},goal:{id:'martin',distance:7.5,bearing:0}});
 assert.ok(hint.lostSeconds<.1);
});
