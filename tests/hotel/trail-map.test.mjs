import {setLanguage} from '../../public/locale-state.mjs';
setLanguage('en');
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrailMap } from '../../public/hotel/trail-map.mjs';
import { createState } from '../../public/hotel/world.mjs';
import { WALLS as TUTORIAL_WALLS, DOOR } from '../../public/tutorial/room-layout.mjs';

// Record actual lines and labels to verify complete geometry and exclusions.
function canvasBoundary() {
  const canvas = { width: 360, height: 300 };
  let path = [], cursor = null, mask = null, stack = [];
  const pixels = new Set(), strokes = [], fills = [], texts = [];
  const inside = (x, y) => !mask || mask.some(circle => Math.hypot(x - circle.x, y - circle.y) <= circle.radius);
  const paint = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(length * 2));
    for (let i = 0; i <= count; i++) {
      const x = a.x + (b.x - a.x) * i / count, y = a.y + (b.y - a.y) * i / count;
      if (inside(x, y)) pixels.add(`${Math.round(x)},${Math.round(y)}`);
    }
  };
  const context = {
    globalAlpha: 1,
    save() { stack.push({ mask, globalAlpha: this.globalAlpha }); },
    restore() { const prior = stack.pop(); mask = prior.mask; this.globalAlpha = prior.globalAlpha; },
    setTransform() {},
    fillRect(x,y,w,h) { if(w===canvas.width&&h===canvas.height){pixels.clear();strokes.length=0;fills.length=0;texts.length=0;}else paint({x,y},{x:x+w,y:y+h}); },
    fillText(text,x,y) {texts.push({text,x,y});},
    beginPath() { path = []; cursor = null; },
    moveTo(x, y) { cursor = { x, y }; },
    lineTo(x, y) { if (cursor) path.push({ type: 'line', a: cursor, b: { x, y } }); cursor = { x, y }; },
    arc(x, y, radius) { path.push({ type: 'circle', x, y, radius }); },
    closePath() {},
    clip() { mask = path.filter(item => item.type === 'circle'); },
    stroke() {
      if (!this.globalAlpha) return;
      strokes.push({ mask: mask && [...mask], alpha: this.globalAlpha });
      for (const item of path) if (item.type === 'line') paint(item.a, item.b);
    },
    fill() {
      if (!this.globalAlpha) return;
      fills.push({ mask: mask && [...mask], alpha: this.globalAlpha });
      for (const item of path) if (item.type === 'line') paint(item.a, item.b);
    },
  };
  canvas.getContext = () => context;
  const worldPoint = (x, y) => {
    const padding = Math.min(canvas.width, canvas.height) * 0.04;
    const scale = Math.min((canvas.width - padding * 2) / 18, (canvas.height - padding * 2) / 15);
    return { x: (canvas.width - 18 * scale) / 2 + x * scale, y: (canvas.height - 15 * scale) / 2 + (12 - y) * scale };
  };
  return {
    canvas, pixels, strokes, fills, texts, worldPoint,
    litNear(x, y, radius = 2) {
      const p = worldPoint(x, y);
      return [...pixels].some(key => { const [a, b] = key.split(',').map(Number); return Math.hypot(p.x - a, p.y - b) <= radius; });
    },
  };
}

function move(map, state, x, y, elapsed = 0.5) {
  state.player.x = x; state.player.y = y; state.elapsed += elapsed; map.update(state);
}

function revealEntrance(map, state) {
  map.update(state);
  move(map, state, 5, -1.1);
  move(map, state, 5, -0.6);
  state.elapsed += 1; map.update(state);
}

test('the full ground floor and own marker are visible before any movement', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();
  map.update(state);
  for(const [x,y] of [[0,0],[18,0],[18,12],[10,10],[14,10]])assert.ok(c.litNear(x,y),`Wall ${x},${y} is visible at entry`);
  assert.equal(map.getStats().floors[0].distance,0);
  assert.equal(map.getStats().markerVisible,true);
  assert.ok(c.texts.some(t=>t.text==='Reception'));
  assert.ok(c.texts.some(t=>t.text==='Stairs'));
  assert.ok(c.strokes.every(stroke=>stroke.mask===null));
});

test('hotel people and recorder are shown; arbitrary targets never affect the map', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();map.update(state);
  assert.deepEqual(map.getStats().visibleMarkers,['martin','claire','elena']);
  for(const name of ['Martin','Claire','Elena'])assert.ok(c.texts.some(t=>t.text===name));
  const before=[...c.pixels].sort(),labels=structuredClone(c.texts);
  Object.assign(state.sources,{motor:{x:5,y:5,floor:0},hunter:{x:15,y:9,floor:0},exit:{x:17,y:11,floor:0}});
  map.update(state);assert.deepEqual([...c.pixels].sort(),before);assert.deepEqual(c.texts,labels);
  state.player.floor=1;state.player.x=13.1;state.player.y=10;map.update(state);
  assert.deepEqual(map.getStats().visibleMarkers,['cleaner','cart','recorder']);
  assert.ok(c.texts.some(t=>t.text==='Recorder'));
  assert.ok(c.litNear(0,0)&&c.litNear(18,12),'Entire upper floor is visible on arrival');
});

test('open-field map shows its boundary immediately and cannot expose motor or opponent', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas,{scene:'chase',walls:[],bounds:{width:8,height:8,north:8}});
  const state={player:{x:2,y:2,floor:0,heading:0},elapsed:0};map.update(state);
  assert.ok(c.pixels.size>500);assert.equal(map.getStats().markerVisible,true);assert.deepEqual(c.texts,[]);
  const before=[...c.pixels].sort();state.sources={motor:{x:6,y:6,floor:0},hunter:{x:4,y:7,floor:0},martin:{x:3,y:3,floor:0}};
  state.opponent={x:5,y:5};map.update(state);assert.deepEqual([...c.pixels].sort(),before);assert.deepEqual(map.getStats().visibleMarkers,[]);
});

test('tutorial shows actual walls and door state but never any sound source', () => {
  const c=canvasBoundary(),walls=TUTORIAL_WALLS.map(w=>({floor:0,x1:w.a.x,y1:w.a.y,x2:w.b.x,y2:w.b.y}));
  const map=new TrailMap(c.canvas,{scene:'tutorial',walls,door:DOOR,bounds:{width:8,height:8,north:8}});
  const state={player:{x:2,y:1,floor:0,heading:0},elapsed:0,doors:{main:0}};map.update(state);
  const closed=[...c.pixels].sort();assert.ok(closed.length>500);assert.equal(map.getStats().markerVisible,true);
  state.sources={rain:{x:6,y:6,floor:0},forest:{x:1,y:5,floor:0},fire:{x:7,y:2,floor:0}};
  map.update(state);assert.deepEqual([...c.pixels].sort(),closed);assert.deepEqual(map.getStats().visibleMarkers,[]);
  state.doors.main=1;map.update(state);assert.notDeepEqual([...c.pixels].sort(),closed);assert.deepEqual(c.texts,[]);
});

test('stairs keep the full plan but never connect personal trails across floors', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();revealEntrance(map,state);
  const original=map.getStats().floors[0];
  state.stairs={from:0,to:1,progress:.5};move(map,state,10,5,1);
  assert.deepEqual(map.getStats().floors[0],original);assert.equal(map.getStats().markerVisible,false);
  assert.ok(c.litNear(18,12));
  state.stairs=null;state.player.floor=1;move(map,state,13.1,10,1);
  assert.equal(map.getStats().floors[1].distance,0);assert.equal(map.getStats().floors[1].points,1);assert.equal(map.getStats().markerVisible,true);
  move(map,state,12.6,10);const upstairs=map.getStats().floors[1];
  state.stairs={from:1,to:0,progress:.5};move(map,state,15,8,1);
  state.stairs=null;state.player.floor=0;move(map,state,16,7.1,1);
  assert.equal(map.getStats().floors[0].distance,original.distance);assert.equal(map.getStats().floors[0].segments,2);
  assert.deepEqual(map.getStats().floors[1],upstairs);
});

test('pause freezes the pose and trail; reset clears the trail but preserves the plan', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();revealEntrance(map,state);
  state.paused=true;const stats=map.getStats(),pixels=[...c.pixels].sort();move(map,state,15,11,100);
  assert.deepEqual(map.getStats(),stats);assert.deepEqual([...c.pixels].sort(),pixels);
  map.reset();assert.deepEqual(map.getStats().floors,{});assert.ok(c.litNear(18,12));
  map.update(createState());assert.equal(map.getStats().floors[0].distance,0);assert.equal(map.getStats().markerVisible,true);
});

test('unexpected discontinuities do not add a false walked shortcut', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();revealEntrance(map,state);
  const walked=map.getStats().floors[0].distance;move(map,state,16,7,1);
  assert.equal(map.getStats().floors[0].distance,walked);assert.equal(map.getStats().floors[0].segments,2);
});

test('resizing preserves complete geometry, markers and path memory', () => {
  const c=canvasBoundary(),map=new TrailMap(c.canvas),state=createState();revealEntrance(map,state);
  const stats=map.getStats();c.canvas.width=720;c.canvas.height=600;map.update(state);
  assert.deepEqual(map.getStats(),stats);assert.ok(c.litNear(18,12));assert.ok(c.texts.some(t=>t.text==='Martin'));
});
