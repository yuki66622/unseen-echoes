// WorldSpec v1 semantic checks and the four-room compiler. Geometry is a
// direct port of unseen/world_plan.py; no generated code is ever evaluated.
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>own(value,key));
const count=value=>[...value].length;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const pointKey=point=>`${Math.floor(point.x)},${Math.floor(point.y)}`;
const TEXT=limit=>({type:'string',minLength:1,maxLength:limit});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const SOUND_IDS=Object.freeze(['rain','forest','fire']);
export const PLAN_CHOICES=Object.freeze({
  layout:Object.freeze(['branching','procession','loop']),width:Object.freeze([12,14,16]),height:Object.freeze([10,12]),
  doorPosition:Object.freeze(['near','middle','far']),rainRoom:Object.freeze(['north-east','south-east','south-west']),
});
const choices=Object.fromEntries(Object.entries(PLAN_CHOICES).map(([key,values])=>[key,{type:typeof values[0]==='number'?'integer':'string',enum:[...values]}]));
export const PLAN_SCHEMA=obj({title:TEXT(90),introduction:TEXT(550),completion:TEXT(400),...choices,
  swapOtherSounds:{type:'boolean'},descriptions:obj(Object.fromEntries(SOUND_IDS.map(id=>[id,TEXT(240)])))});
const bilingualText=limit=>obj({zh:TEXT(limit),en:TEXT(limit)});
export const BILINGUAL_PLAN_SCHEMA=obj({title:bilingualText(90),introduction:bilingualText(550),completion:bilingualText(400),...choices,
  swapOtherSounds:{type:'boolean'},descriptions:obj(Object.fromEntries(SOUND_IDS.map(id=>[id,bilingualText(240)])))});
const WORLD_KEYS=['version','title','introduction','completion','grid','spawn','exit','doors','sources','targetSourceId'];

export class WorldValidationError extends Error{
  constructor(message){super(message);this.name='WorldValidationError';}
}
const require=(condition,message)=>{if(!condition)throw new WorldValidationError(message);};
function text(value,limit,context){
  require(typeof value==='string'&&count(value.trim())>0&&count(value.trim())<=limit,`${context} has invalid text.`);
  require(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),`${context} contains control characters.`);
}

// A north-up display may flip y, but the runtime's stored grid and coordinates
// remain unchanged: grid[row][column], heading 0 points toward increasing y.
function reachable(grid,start,closed=false){
  const queue=[[Math.floor(start.x),Math.floor(start.y)]],seen=new Set([pointKey(start)]);
  for(let cursor=0;cursor<queue.length;cursor++){
    const [x,y]=queue[cursor];
    for(const [a,b]of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
      if(b<0||b>=grid.length||a<0||a>=grid[0].length)continue;
      const tile=grid[b][a],key=`${a},${b}`;
      if(tile==='#'||closed&&tile==='D'||seen.has(key))continue;
      seen.add(key);queue.push([a,b]);
    }
  }
  return seen;
}

export function validateWorld(world){
  require(exact(world,WORLD_KEYS),'World has invalid fields.');
  require(Number.isInteger(world.version)&&world.version===1,'Unsupported world version.');
  for(const [key,limit]of [['title',90],['introduction',550],['completion',400]])text(world[key],limit,key);
  const grid=world.grid;
  require(Array.isArray(grid)&&grid.length>=8&&grid.length<=16,'Map height must be 8–16 cells.');
  require(grid.every(row=>typeof row==='string'),'Map rows must be strings.');
  const width=grid[0].length;
  require(width>=10&&width<=16&&grid.every(row=>row.length===width),'Map must be rectangular, 10–16 cells wide.');
  require(grid.every(row=>/^[#.D]+$/.test(row)),'Map contains unknown tiles.');
  require(/^#+$/.test(grid[0]+grid.at(-1))&&grid.every(row=>row[0]==='#'&&row.at(-1)==='#'),'Map boundary must be solid.');
  const floor=new Set();for(let y=0;y<grid.length;y++)for(let x=0;x<width;x++)if(grid[y][x]!=='#')floor.add(`${x},${y}`);
  require(floor.size>=20&&floor.size<=150,'Map needs 20–150 accessible tiles.');
  const point=(value,tile,context,fields=['x','y'])=>{
    require(exact(value,fields),`${context} has invalid fields.`);
    for(const [axis,upper]of [['x',width],['y',grid.length]]){
      const n=value[axis];require(finite(n)&&n>=.5&&n<upper,`${context} has an invalid coordinate.`);
      require(Math.abs(n%1-.5)<1e-9,`${context} must be at a tile center.`);
    }
    require(grid[Math.floor(value.y)][Math.floor(value.x)]===tile,`${context} is on the wrong tile.`);
  };
  point(world.spawn,'.','Spawn',['x','y','heading']);
  require(finite(world.spawn.heading)&&world.spawn.heading>=0&&world.spawn.heading<=2*Math.PI,'Invalid initial heading.');
  point(world.exit,'.','Exit');require(pointKey(world.exit)===pointKey(world.spawn),'The exit must be at the arrival point.');
  require(Array.isArray(world.doors)&&world.doors.length>=1&&world.doors.length<=4,'A world needs 1–4 doors.');
  const ids=new Set(),doorCells=new Set();
  for(const door of world.doors){
    point(door,'D','Door',['id','x','y']);
    require(typeof door.id==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(door.id),'Invalid door id.');
    const key=pointKey(door);require(!ids.has(door.id)&&!doorCells.has(key),'Duplicate door.');ids.add(door.id);doorCells.add(key);
    const x=Math.floor(door.x),y=Math.floor(door.y);
    const horizontal=grid[y][x-1]==='.'&&grid[y][x+1]==='.'&&grid[y-1][x]==='#'&&grid[y+1][x]==='#';
    const vertical=grid[y-1][x]==='.'&&grid[y+1][x]==='.'&&grid[y][x-1]==='#'&&grid[y][x+1]==='#';
    require(horizontal||vertical,'Each door must join two opposite floor tiles across a wall.');
  }
  const declared=new Set();for(let y=0;y<grid.length;y++)for(let x=0;x<width;x++)if(grid[y][x]==='D')declared.add(`${x},${y}`);
  require(declared.size===doorCells.size&&[...declared].every(key=>doorCells.has(key)),'Door declarations do not match the map.');
  require(Array.isArray(world.sources)&&world.sources.length===3,'Exactly three sound sources are required.');
  const sourceIds=new Set(),sounds=new Set();
  for(const source of world.sources){
    point(source,'.','Sound source',['id','soundId','x','y','description']);
    require(typeof source.id==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(source.id),'Invalid source id.');
    require(!sourceIds.has(source.id)&&!ids.has(source.id),'Duplicate source id.');
    require(typeof source.soundId==='string'&&SOUND_IDS.includes(source.soundId),'Unknown audio asset.');
    sourceIds.add(source.id);sounds.add(source.soundId);text(source.description,240,'Sound description');
    require(Math.hypot(source.x-world.spawn.x,source.y-world.spawn.y)>=2,'A sound is too close to arrival.');
  }
  require(sounds.size===3&&SOUND_IDS.every(id=>sounds.has(id)),'Use rain, forest and fire exactly once.');
  for(let i=0;i<world.sources.length;i++)for(let j=i+1;j<world.sources.length;j++){
    const a=world.sources[i],b=world.sources[j];require(Math.hypot(a.x-b.x,a.y-b.y)>=2,'Sound sources are too close together.');
  }
  require(typeof world.targetSourceId==='string','Invalid target source.');
  const target=world.sources.find(source=>source.id===world.targetSourceId);
  require(target?.soundId==='rain','The target must be the rain source.');
  const open=reachable(grid,world.spawn);require(open.size===floor.size&&[...floor].every(key=>open.has(key)),'Some map tiles cannot be reached even after opening the doors.');
  require(!reachable(grid,world.spawn,true).has(pointKey(target)),'The rain must be behind at least one door.');
  return world;
}

function validatePlanFields(plan,schema){
  require(exact(plan,Object.keys(schema.properties)),'Invalid room plan fields.');
  for(const [key,values]of Object.entries(PLAN_CHOICES))require(values.includes(plan[key]),`Invalid room plan ${key}.`);
  require(typeof plan.swapOtherSounds==='boolean','Invalid sound arrangement.');
  require(exact(plan.descriptions,SOUND_IDS),'Invalid sound descriptions.');
}

export function compilePlan(plan){
  validatePlanFields(plan,PLAN_SCHEMA);
  const {width,height}=plan,midx=Math.floor(width/2),midy=Math.floor(height/2);
  const grid=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>[0,width-1,midx].includes(x)||[0,height-1,midy].includes(y)?'#':'.'));
  const index={near:0,middle:1,far:2}[plan.doorPosition],choose=(lo,hi)=>[lo,Math.floor((lo+hi)/2),hi][index];
  const links={north:[midx,choose(2,midy-2)],east:[choose(midx+1,width-2),midy],south:[midx,choose(midy+1,height-2)],west:[choose(2,midx-2),midy]};
  const edges={branching:['north','west','south'],procession:['north','east','south'],loop:['north','east','south','west']}[plan.layout];
  const doors=edges.map(name=>{const [x,y]=links[name];grid[y][x]='D';return {id:name+'-door',x:x+.5,y:y+.5};});
  const slots={'north-east':[width-2.5,2.5],'south-east':[width-2.5,height-2.5],'south-west':[2.5,height-2.5]};
  const remaining=Object.keys(slots).filter(name=>name!==plan.rainRoom);if(plan.swapOtherSounds)remaining.reverse();
  const assignments={rain:plan.rainRoom,forest:remaining[0],fire:remaining[1]};
  const sources=SOUND_IDS.map(soundId=>{const [x,y]=slots[assignments[soundId]];return {id:soundId+'-echo',soundId,x,y,description:plan.descriptions[soundId]};});
  return validateWorld({version:1,title:plan.title,introduction:plan.introduction,completion:plan.completion,
    grid:grid.map(row=>row.join('')),spawn:{x:2.5,y:2.5,heading:0},exit:{x:2.5,y:2.5},doors,sources,targetSourceId:'rain-echo'});
}

function bilingual(value,limit,context){
  require(exact(value,['zh','en']),`${context} needs Chinese and English text.`);
  for(const language of ['zh','en']){
    text(value[language],limit,context+'.'+language);
    require(!/<\s*\/?\s*[a-z!][^>]*>/i.test(value[language])&&!/```/.test(value[language]),`${context} must be plain text.`);
  }
}
export function compileBilingualPlan(plan,language='zh'){
  require(['zh','en'].includes(language),'Unsupported display language.');validatePlanFields(plan,BILINGUAL_PLAN_SCHEMA);
  for(const [key,limit]of [['title',90],['introduction',550],['completion',400]])bilingual(plan[key],limit,key);
  for(const id of SOUND_IDS)bilingual(plan.descriptions[id],240,'description.'+id);
  const worlds={};for(const locale of ['zh','en'])worlds[locale]=compilePlan({...plan,title:plan.title[locale],introduction:plan.introduction[locale],completion:plan.completion[locale],descriptions:Object.fromEntries(SOUND_IDS.map(id=>[id,plan.descriptions[id][locale]]))});
  const worldDisplay=Object.fromEntries(['zh','en'].map(locale=>[locale,{title:worlds[locale].title,introduction:worlds[locale].introduction,completion:worlds[locale].completion,sources:Object.fromEntries(worlds[locale].sources.map(source=>[source.id,source.description]))}]));
  return {world:worlds[language],worldDisplay};
}

// Used before accepting browser-local saved data. Return the same envelope;
// validation never repairs corrupt geometry or silently substitutes a fixture.
export function validateEnvelope(envelope){
  require(object(envelope),'Invalid saved world.');validateWorld(envelope.world);
  require(Object.keys(envelope).every(key=>['id','createdAt','origin','model','world','worldDisplay','usage','elapsedSeconds'].includes(key)),'Invalid saved world fields.');
  require(typeof envelope.id==='string'&&/^[a-f0-9]{32}$/.test(envelope.id),'Invalid world identity.');
  require(typeof envelope.createdAt==='string'&&Number.isFinite(Date.parse(envelope.createdAt)),'Invalid creation time.');
  require(envelope.origin==='gemini'||envelope.origin==='fixture','Invalid world origin.');
  require(typeof envelope.model==='string'&&count(envelope.model)<=100,'Invalid model name.');
  require(exact(envelope.worldDisplay,['zh','en']),'Invalid bilingual display.');
  for(const locale of ['zh','en']){
    const display=envelope.worldDisplay[locale];require(exact(display,['title','introduction','completion','sources']),'Invalid display fields.');
    for(const [key,limit]of [['title',90],['introduction',550],['completion',400]]){
      text(display[key],limit,key);require(!/<\s*\/?\s*[a-z!][^>]*>/i.test(display[key])&&!/```/.test(display[key]),'Display must be plain text.');
    }
    const ids=envelope.world.sources.map(source=>source.id);require(exact(display.sources,ids),'Invalid source display.');
    for(const id of ids){text(display.sources[id],240,'Source display');require(!/<\s*\/?\s*[a-z!][^>]*>/i.test(display.sources[id])&&!/```/.test(display.sources[id]),'Source display must be plain text.');}
  }
  require(!own(envelope,'audioAssets')&&!own(envelope,'audioStatus'),'Saved worlds cannot supply audio assets.');
  return envelope;
}
