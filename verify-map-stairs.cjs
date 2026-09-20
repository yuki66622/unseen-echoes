const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786',out=process.env.QA_OUTPUT||'validation/map-stairs';
fs.mkdirSync(out,{recursive:true});const report={base,checks:[],errors:[]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:850},permissions:[],storageState:{cookies:[],origins:[{origin:new URL(base).origin,localStorage:[{name:'unseen-language',value:'en'}]}]},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))report.errors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
  await page.goto(base+'/hotel/?silent=1&debug=1');await page.locator('#case-envelope').click();await page.locator('#start').click();await page.locator('#chat').waitFor();
  await page.addStyleTag({content:'#debug{display:none!important}'});
  const state=()=>page.locator('#qa-state').textContent().then(JSON.parse);
  await page.waitForFunction(()=>{try{const t=JSON.parse(document.getElementById('qa-state').textContent).trail;return t.fullyVisible&&t.floors[0]&&t.markerVisible;}catch{return false;}});
  const first=await state();assert.equal(first.trail.floors[0].distance,0);assert.equal(first.trail.markerVisible,true);
  assert.deepEqual(first.trail.visibleMarkers,['martin','claire','elena']);
  const lit=await page.locator('#trail-canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>100)n++;return n;});
  assert.ok(lit>4000);await page.screenshot({path:out+'/hotel-ground.png'});pass('hotel starts with the complete ground floor, landmarks and own position before walking');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/hotel-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1280,height:850});
  await page.evaluate(()=>{window.__observedSpeech=[];setInterval(()=>{try{const s=JSON.parse(document.getElementById('qa-state').textContent);for(const v of s.audio.voices)if(v.kind==='speech'&&!window.__observedSpeech.some(x=>x.id===v.id))window.__observedSpeech.push(v);}catch{}},60);});
  const keys=async(key,count=1)=>{for(let n=0;n<count;n++){await page.keyboard.press(key);await page.waitForTimeout(440);}};
  await keys('ArrowUp');await keys('f');await page.waitForTimeout(450);
  await keys('ArrowUp',11);await page.waitForFunction(()=>window.__observedSpeech.some(v=>v.id==='MARTIN-WELCOME-EN-R1'));const welcome=await page.evaluate(()=>window.__observedSpeech.find(v=>v.id==='MARTIN-WELCOME-EN-R1'));assert.ok(welcome.duration>2&&welcome.duration<4);await page.waitForFunction(()=>window.__observedSpeech.some(v=>v.id==='DLG-01-EN-R4'));assert.equal((await state()).searchAttempts,0);pass('Martin welcome recording plays on real entry, followed by directions without spending E');await keys('ArrowRight',3);await keys('ArrowUp',8);await keys('f');await page.waitForTimeout(450);
  await keys('ArrowUp',14);await keys('ArrowLeft',3);await keys('ArrowUp',7);
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>{const s=JSON.parse(document.getElementById('qa-state').textContent);return s.stairs?.to===1&&s.audio.voices.some(v=>v.id==='stairs-up');},null,{timeout:10000});
  const ascent=await state(),clip=ascent.audio.voices.find(v=>v.id==='stairs-up');
  assert.equal(clip.duration,3);assert.equal(clip.loop,false);assert.equal(clip.group,'stairs');
  assert.ok(!ascent.audio.voices.some(v=>v.id==='step-wood'));assert.equal(ascent.audio.finalOutputGain,0);
  await page.keyboard.press('p');await page.waitForFunction(()=>JSON.parse(document.getElementById('qa-state').textContent).paused);
  const frozen=(await state()).stairs.progress;await page.waitForTimeout(400);assert.equal((await state()).stairs.progress,frozen);
  await page.keyboard.press('p');await page.waitForFunction(()=>JSON.parse(document.getElementById('qa-state').textContent).player.floor===1);
  await page.waitForFunction(()=>!JSON.parse(document.getElementById('qa-state').textContent).audio.voices.some(v=>v.id==='stairs-up'));
  pass('real arrow-key ascent plays exactly the three-second clip once; pause/resume works without old wood steps');
  const upper=await state();assert.deepEqual(upper.trail.visibleMarkers,['cleaner','cart','recorder']);assert.equal(upper.trail.markerVisible,true);
  await page.screenshot({path:out+'/hotel-upper.png'});assert.deepEqual(upper.audio.errors,[]);pass('arrival shows the full upper floor, stairs and recorder immediately');
  await page.goto(base+'/tutorial/?silent=1');await page.locator('#start').click();await page.locator('body.has-entered').waitFor();
  await page.locator('#trail-map[data-revealed="true"]').waitFor();await page.locator('#orientation').waitFor();assert.equal(await page.locator('#chat-toggle').getAttribute('aria-expanded'),'false');pass('tutorial shows its source-free map and compass with Gemini collapsed');
  const other=await browser.newContext({viewport:{width:1280,height:850},permissions:[],storageState:{cookies:[],origins:[{origin:new URL(base).origin,localStorage:[{name:'unseen-language',value:'en'}]}]},reducedMotion:'reduce'}),b=await other.newPage();
  for(const [p,name]of [[page,'Map A'],[b,'Map B']]){await p.goto(base+'/?chapter=lobby&silent=1&qa=1');await p.locator('#player-name').fill(name);await p.locator('#profile-form button').click();}
  await page.locator('#create-room').click();await page.locator('#active-code').waitFor();const code=(await page.locator('#active-code').textContent()).trim();
  await b.locator('#show-join').click();await b.locator('#room-code').fill(code);await b.locator('#join-room').click();
  await page.locator('[data-role="hunter"]').click();await b.locator('[data-role="survivor"]').click();await page.locator('#ready').click();await b.locator('#ready').click();
  for(const p of [page,b]){await p.waitForFunction(()=>window.__unseen?.state().phase==='chase');await p.locator('#trail-map[data-revealed="true"]').waitFor();}
  await page.waitForFunction(()=>window.__unseen.state().room.game.headstartSeconds===0);const heading=await page.evaluate(()=>window.__unseen.state().pose.heading);
  const before=await b.locator('#trail-canvas').evaluate(c=>c.toDataURL());await page.keyboard.press('ArrowRight');await page.waitForFunction(before=>window.__unseen.state().pose.heading!==before,heading);await page.waitForTimeout(600);
  assert.equal(await b.locator('#trail-canvas').evaluate(c=>c.toDataURL()),before,'Hunter rotation does not change the survivor map');
  for(const p of [page,b]){await p.locator('#play-panel').waitFor();await p.waitForFunction(()=>window.__unseen.state().visual.rms>0);assert.equal(await p.evaluate(()=>window.__menuAudio.state().paused),true);}await b.screenshot({path:out+'/chase-map.png'});pass('both chase players see the full open-field map immediately; hunter activity does not leak onto the other map');
  for(const p of [page,b]){
   await p.waitForFunction(()=>window.__unseen.state().audio.voices.some(v=>v.id==='background'));
   const s=await p.evaluate(()=>window.__unseen.state().audio),bg=s.voices.find(v=>v.id==='background');
   assert.equal(bg.loop,true);assert.equal(bg.gain,.25);assert.ok(Math.abs(bg.durationSeconds-30)<.02);
   assert.equal(s.voices.some(v=>v.id==='ending'),false);assert.equal(s.masterGain,0);await p.waitForFunction(()=>window.__menuAudio.state().currentTime>0);assert.equal(await p.evaluate(()=>window.__menuAudio.state().volume),0);
  }
  await page.keyboard.press('ArrowLeft');await page.waitForTimeout(650);
  const far=await page.evaluate(()=>window.__unseen.state().audio.heartbeatGain);
  for(let n=0;n<8;n++){await page.keyboard.press('ArrowUp');await page.waitForTimeout(600);}
  const close=await page.evaluate(()=>window.__unseen.state().audio.heartbeatGain);
  assert.ok(close>far*8,`near heartbeat ${close} is substantially louder than distant ${far}`);
  for(let n=0;n<3;n++){await page.keyboard.press('ArrowUp');await page.waitForTimeout(600);}
  await page.keyboard.press('e');
  for(const p of [page,b]){
   await p.waitForFunction(()=>window.__unseen.state().audio.voices.some(v=>v.id==='ending'));
   const s=await p.evaluate(()=>window.__unseen.state().audio),ending=s.voices.find(v=>v.id==='ending');
   assert.equal(ending.loop,false);assert.equal(s.counters.ending,1);assert.ok(Math.abs(ending.durationSeconds-6.68)<.03);
   assert.equal(s.voices.some(v=>v.id==='background'||v.id==='heartbeat'),false);assert.equal(s.masterGain,0);await p.waitForFunction(()=>window.__menuAudio.state().currentTime>0);assert.equal(await p.evaluate(()=>window.__menuAudio.state().volume),0);
  }
  report.heartbeat={far,close};pass('Epic loops quietly during play, actual approach increases heartbeat strongly, and both players receive the witch ending once');
  assert.deepEqual(report.errors,[]);pass('new map and stairs flow has no browser errors or missing assets');
 }catch(error){report.failure=error.stack;throw error;}
 finally{fs.writeFileSync(out+'/map-stairs.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
