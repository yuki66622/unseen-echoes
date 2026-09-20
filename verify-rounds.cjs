const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786';
const out=process.env.QA_OUTPUT||'validation/rounds';
fs.mkdirSync(out,{recursive:true});
const report={base,checks:[],errors:[]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try{
  const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:1280,height:850},permissions:[],reducedMotion:'reduce'})));
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
  for(const page of [a,b]){
   page.on('pageerror',e=>report.errors.push(e.message));
   if(process.env.TEST_DB_URI)await page.route('**/api/detective/config',async route=>{
    const response=await route.fetch(),config=await response.json();
    config.uri=process.env.TEST_DB_URI;config.identityUri=config.uri;delete config.fallbackUri;
    config.database=process.env.TEST_DB_NAME||'unseen-round-review';await route.fulfill({json:config});
   });
   await page.goto(base+'/?chapter=lobby&silent=1&qa=1');
  }
  for(const [page,name]of [[a,'Round A'],[b,'Round B']]){await page.locator('#player-name').fill(name);await page.locator('#profile-form button').click();}
  await a.locator('#create-room').click();await a.locator('#active-code').waitFor();
  const code=(await a.locator('#active-code').textContent()).trim();
  await b.locator('#show-join').click();await b.locator('#room-code').fill(code);await b.locator('#join-room').click();
  const choose=async(first,second)=>{
   await a.locator(`[data-role="${first}"]`).click();await b.locator(`[data-role="${second}"]`).click();
   await a.locator('#ready').click();await b.locator('#ready').click();
   await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__unseen?.state().phase==='chase',null,{timeout:25000})));
  };
  const capture=async(hunter,misses=0)=>{
   await hunter.waitForFunction(()=>window.__unseen.state().room.game.headstartSeconds===0,null,{timeout:12000});
   for(let n=0;n<misses;n++){
    await hunter.keyboard.press('e');await hunter.waitForFunction(left=>window.__unseen.state().room.game.attemptsRemaining===left,4-n);
   }
   for(let n=0;n<11;n++){await hunter.keyboard.press('ArrowUp');await hunter.waitForTimeout(600);}
   await hunter.keyboard.press('e');
   await Promise.all([a,b].map(p=>p.locator('#result').waitFor({timeout:8000})));
  };
  await choose('hunter','survivor');
  const original=await a.evaluate(()=>window.__unseen.state().room);
  for(const p of [a,b]){
   assert.equal(await p.locator('#controls,[data-action],#interact').count(),0);
   assert.doesNotMatch(await p.locator('body').innerText(),/按\s*[EF]|·\s*[EF]/);
  }
  await a.screenshot({path:out+'/chase-clean.png'});
  await capture(a,4);
  assert.equal(await a.evaluate(()=>window.__unseen.state().room.game.attemptsRemaining),0);
  assert.equal(await a.evaluate(()=>window.__unseen.state().room.game.outcome),'captured');
  pass('a real capture on the fifth E succeeds without repeated controls');
  await a.locator('#rematch').click();
  await a.waitForFunction(()=>window.__unseen.state().room.members.some(p=>p.restartVote));
  assert.equal(await b.evaluate(()=>window.__unseen.state().phase),'chase-result');
  await b.locator('#rematch').click();
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__unseen.state().phase==='lobby')));
  for(const p of [a,b]){
   const state=await p.evaluate(()=>window.__unseen.state().room);
   assert.equal(state.code,original.code);assert.equal(state.game,null);
   assert.deepEqual(state.members.map(m=>m.identity).sort(),original.members.map(m=>m.identity).sort());
   assert.ok(state.members.every(m=>m.role===''&&!m.ready&&!m.restartVote));
   assert.equal(await p.locator('#ready').isDisabled(),true);
   assert.equal(await p.locator('[data-role][aria-pressed="true"]').count(),0);
   await p.locator('#trail-map').waitFor({state:'hidden'});
  }
  await a.screenshot({path:out+'/choose-again.png'});
  pass('both restart votes return the same room to empty role selections and require new readiness');
  await choose('survivor','hunter');
  const fresh=await a.evaluate(()=>window.__unseen.state().room.game);
  assert.notEqual(fresh.roundId,original.game.roundId);assert.equal(fresh.role,'survivor');assert.equal(fresh.attemptsRemaining,5);
  await capture(b);pass('players swap roles, start a fresh round and finish with the new hunter');
  await a.locator('#rematch').click();await b.locator('#rematch').click();
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__unseen.state().phase==='lobby')));
  await choose('hunter','survivor');
  await a.waitForFunction(()=>window.__unseen.state().room.game.headstartSeconds===0);
  for(let n=0;n<2;n++){await a.keyboard.press('e');await a.waitForFunction(left=>window.__unseen.state().room.game.attemptsRemaining===left,4-n);}
  const beforeReload=await a.evaluate(()=>window.__unseen.state().room.game.roundId);
  await a.reload();await a.waitForFunction(()=>window.__unseen?.state().phase==='chase'&&window.__unseen.state().audio.running&&!window.__unseen.state().paused&&!window.__unseen.state().room.game.paused);
  assert.equal(await a.evaluate(()=>window.__unseen.state().room.game.roundId),beforeReload);
  assert.equal(await a.evaluate(()=>window.__unseen.state().room.game.attemptsRemaining),3);
  for(let n=0;n<3;n++){await a.keyboard.press('e');await a.waitForFunction(left=>window.__unseen.state().room.game.attemptsRemaining===left,2-n);}
  await Promise.all([a,b].map(p=>p.locator('#result').waitFor()));
  const exhausted=await a.evaluate(()=>window.__unseen.state().room.game);
  assert.equal(exhausted.outcome,'attempts_exhausted');assert.equal(exhausted.winner,'survivor');
  pass('refresh preserves the remaining budget and five unsuccessful checks end the shared round');
  for(const p of [a,b]){await p.locator('#next-level').click();await p.locator('#case-envelope').waitFor();}
  await a.locator('#case-envelope').click();await a.locator('#start').click();await a.locator('#chat').waitFor();
  assert.equal(await a.locator('kbd,[data-move]').count(),0);
  assert.equal(await a.locator('#context-actions button').count(),0);
  await a.locator('#settings-toggle').click();
  assert.equal(await a.locator('#settings-toggle').innerText(),'Settings');
  assert.equal(await a.locator('.movement').count(),0);
  await a.locator('#settings-toggle').click();
  await a.screenshot({path:out+'/hotel-clean.png'});
  pass('hotel keeps the letter and functional settings while removing repeated movement and E prompts');
  for(let n=0;n<5;n++){await a.keyboard.press('e');if(n<4)await a.waitForFunction(left=>document.getElementById('search-budget').textContent===`Checks left ${left} / 5`,4-n);}
  await a.locator('#ending').waitFor();assert.equal(await a.locator('#ending-status').textContent(),'SEARCH ENDED');
  await a.locator('#play-again').click();await a.locator('#chat').waitFor();
  await a.waitForFunction(()=>document.getElementById('search-budget').textContent==='Checks left 5 / 5');
  pass('hotel ends after five empty checks and restart restores all five attempts');
  await a.goto(base+'/tutorial/?silent=1');await a.locator('#start').click();await a.locator('body.has-entered').waitFor();
  for(let n=0;n<6;n++)await a.keyboard.press('e');
  const before=await a.locator('#coords').textContent();await a.keyboard.press('ArrowUp');
  await a.waitForFunction(()=>document.getElementById('map').dataset.moving==='false');
  assert.notEqual(await a.locator('#coords').textContent(),before);assert.equal(await a.locator('#search-budget').count(),0);
  pass('tutorial keeps its controls and remains playable after more than five checks');
  assert.deepEqual(report.errors,[]);pass('updated flow has no browser errors');
 }catch(error){
  report.failure=error.stack;
  report.states=await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.evaluate(()=>{
   const s=window.__unseen?.state();return {phase:s?.phase,paused:s?.paused,audioRunning:s?.audio?.running,attempts:s?.room?.game?.attemptsRemaining,headstart:s?.room?.game?.headstartSeconds,roomPaused:s?.room?.game?.paused,status:document.getElementById('status')?.textContent};
  }).catch(()=>null)));
  throw error;
 }
 finally{fs.writeFileSync(out+'/rounds-browser.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
