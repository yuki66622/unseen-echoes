const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786',out=process.env.QA_OUTPUT||'validation';
fs.mkdirSync(out,{recursive:true});const report={base,db:process.env.TEST_DB_URI?'local testing database':'production gateway',checks:[],errors:[]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try{
  const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:1280,height:850},permissions:[],reducedMotion:'reduce'})));
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));for(const p of [a,b])p.on('pageerror',e=>report.errors.push(e.message));
  await a.goto(base+'/tutorial/?silent=1&seed=42');await a.locator('#start').click();await a.locator('body.has-entered').waitFor();
  const key=async(p,k,n=1,ms=580)=>{for(let i=0;i<n;i++){await p.keyboard.press(k);await p.waitForTimeout(ms);}};
  await a.locator('#voice-output-enabled').uncheck({force:true}).catch(()=>{});
  await key(a,'ArrowUp',9);await key(a,'ArrowRight',3,300);await key(a,'ArrowUp',2);await key(a,'f',1,50);await key(a,'ArrowUp',6);await key(a,'e',1,80);
  await a.getByRole('link',{name:'教程完成 · 进入双人追逐'}).waitFor();pass('real keyboard tutorial reaches rain through the door and unlocks chapter continuation');
  if(process.env.TEST_DB_URI){for(const p of [a,b])await p.route('**/api/detective/config',async r=>{const res=await r.fetch(),data=await res.json();data.uri=process.env.TEST_DB_URI;data.identityUri=data.uri;delete data.fallbackUri;data.database='unseen-chase-audio-v2';await r.fulfill({json:data});});}
  await a.getByRole('link',{name:'教程完成 · 进入双人追逐'}).click();await b.goto(base+'/?chapter=lobby&silent=1&qa=1');
  // Enable read-only diagnostics on the first client after testing the real bridge.
  await a.goto(base+'/?chapter=lobby&silent=1&qa=1');
  for(const [p,name] of [[a,'Integration A'],[b,'Integration B']]){await p.locator('#player-name').fill(name);await p.locator('#profile-form button').click();}
  await a.locator('#create-room').click();await a.locator('#active-code').waitFor();const code=(await a.locator('#active-code').textContent()).trim();assert.match(code,/^[A-Z0-9]{6}$/);
  await b.locator('#show-join').click();await b.locator('#room-code').fill(code);await b.locator('#join-room').click();
  await a.locator('[data-role="hunter"]').click();await b.locator('[data-role="survivor"]').click();
  await a.locator('#ready').click();await b.locator('#ready').click();
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__unseen?.state().phase==='chase',{},{timeout:25000})));
  const ga=await a.evaluate(()=>window.__unseen.state().room.game),gb=await b.evaluate(()=>window.__unseen.state().room.game);
  assert.equal(ga.mapId,'square-open-v2');assert.ok('heartbeatIntensity' in ga);assert.ok(!('heartbeatIntensity' in gb));
  pass('two independent players create, join, prepare audio and start matching square-open-v2 rules');
  await a.waitForFunction(()=>window.__unseen.state().room.game.headstartSeconds===0,{},{timeout:12000});
  await a.locator('#orientation').waitFor();
  assert.equal(await a.locator('#trail-map').getAttribute('data-revealed'),'false');
  await key(a,'ArrowUp',3,600);
  await a.waitForFunction(()=>document.querySelector('#trail-map')?.dataset.revealed==='true');
  assert.equal(await b.locator('#trail-map').getAttribute('data-revealed'),'false','A stationary opponent has no explored path');
  for(const viewport of [{width:1280,height:850},{width:768,height:850},{width:390,height:844},{width:390,height:600}]){
    await a.setViewportSize(viewport);
    const overlap=await a.evaluate(()=>{
      const map=document.querySelector('#trail-map').getBoundingClientRect();
      return ['#chapter','#network-indicator','#settings-button','#sound-toggle'].filter(selector=>{
        const r=document.querySelector(selector).getBoundingClientRect();
        return r.width>0&&r.height>0&&r.left<map.right&&r.right>map.left&&r.top<map.bottom&&r.bottom>map.top;
      });
    });
    assert.deepEqual(overlap,[],`Header overlaps map at ${viewport.width}×${viewport.height}`);
  }
  await a.setViewportSize({width:1280,height:850});
  await a.screenshot({path:out+'/integrated-chase-map.png'});
  pass('shared chase map reveals only each player’s own walking and retains the right compass');
  await key(a,'ArrowUp',8,600);await key(a,'e',1,80);await Promise.all([a,b].map(p=>p.locator('#result').waitFor({timeout:8000})));
  pass('real hunter keyboard movement and interaction produce a shared capture result');
  await a.locator('#next-level').click();await a.waitForURL('**/hotel/**');await a.locator('#case-envelope').waitFor();
  pass('actual chase result leaves the room and opens the hotel investigation');
  await b.locator('#next-level').click();await b.waitForURL('**/hotel/**');pass('both players can independently continue to the hotel');
  await a.locator('#case-envelope').click();await a.locator('#start').click();await a.locator('#chat').waitFor();await a.screenshot({path:out+'/integrated-hotel-play.png'});
  const hotelStatus=await a.evaluate(async()=>{const r=await fetch('/api/hotel/status');const d=await r.json();return {configured:d.configured,speechOutput:d.speechOutput};});assert.equal(hotelStatus.configured,true);pass('hotel opens with its own live conversation configuration');
  assert.deepEqual(report.errors,[]);pass('chapter chain has no browser errors');
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync(out+'/chapters-browser.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
