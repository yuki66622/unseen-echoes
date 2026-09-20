const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786',out=process.env.QA_OUTPUT||'validation/ui-unified';
fs.mkdirSync(out,{recursive:true});
const report={base,checks:[],errors:[]};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:850},permissions:[],reducedMotion:'no-preference'});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))report.errors.push(r.status()+' '+new URL(r.url()).pathname);});
  await page.goto(base+'/?chapter=title&silent=1');
  const opening=page.frameLocator('#opening-frame');
  await opening.locator('[data-renderer="webgl2"]').waitFor();
  await page.screenshot({path:out+'/01-opening.png'});
  let began=Date.now();await opening.locator('#ue-next').click();
  await opening.locator('[data-step="1"][data-transitioning="false"]').waitFor();
  assert.ok(Date.now()-began<1100);pass('opening advances in under one second with motion enabled');
  await opening.locator('#ue-heading').click();await opening.locator('[data-step="2"][data-transitioning="false"]').waitFor();
  assert.equal(await opening.locator('#unseen-echoes-opening').getAttribute('data-step'),'2');
  await page.waitForTimeout(1400);assert.equal(await opening.locator('#unseen-echoes-opening').getAttribute('data-step'),'2');
  pass('one stage click advances exactly once and cancels the automatic tagline timer');
  await opening.locator('#ue-next').press('Enter');await opening.locator('[data-step="3"][data-transitioning="false"]').waitFor();
  await opening.locator('#ue-next').press('Space');await opening.locator('[data-step="4"][data-transitioning="false"]').waitFor();
  pass('opening keyboard Enter and Space advance one passage');await page.emulateMedia({reducedMotion:'reduce'});
  await opening.locator('#ue-skip').click();await opening.locator('#tutorial-entry').click();await page.waitForURL('**/tutorial/**');
  await page.locator('html[data-nebula="ready"]').waitFor();
  await page.screenshot({path:out+'/02-tutorial-entry.png'});
  assert.equal(await page.locator('.key-legend').count(),1);assert.equal(await page.locator('#trail-map').count(),1);
  assert.doesNotMatch(await page.locator('body').innerText(),/W\s*\/\s*S|A\s*\/\s*D/);
  await page.locator('#start').click();await page.locator('body.has-entered').waitFor();
  const pos=await page.locator('#coords').textContent();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>document.getElementById('map').dataset.moving==='false');
  const moved=await page.locator('#coords').textContent();assert.notEqual(pos,moved);
  await page.keyboard.press('w');await page.waitForTimeout(650);assert.equal(await page.locator('#coords').textContent(),moved);
  assert.equal(await page.locator('#orientation').isVisible(),true);assert.equal(await page.locator('#chat-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#chat-body').isVisible(),false);await page.locator('#trail-map[data-revealed="true"]').waitFor();pass('tutorial arrows move, compass and complete source-free map are visible, and Gemini starts collapsed');
  await page.screenshot({path:out+'/03-tutorial-play.png'});
  const palette=await page.locator('#voice-text-send').evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontFamily,radius:s.borderRadius,color:s.color,bg:s.backgroundColor};});
  assert.equal(palette.radius,'0px');assert.equal(palette.bg,'rgba(0, 0, 0, 0)');
  await page.locator('#chat-toggle').click();
  // Recovery test is explicitly mocked; the separate provider check uses real Gemini.
  let sent=0;
  await page.route('**/api/tutorial/interpret',async route=>{
   sent++;assert.equal(route.request().postDataJSON().text,'birds');
   await route.fulfill(sent===1?{status:504,json:{error:{code:'gemini_timeout',message:'Gemini 回复超时，这句话未执行。可以重新发送。'}}}:{json:{text:'birds',mode:'reply',message:'听到了鸟鸣。',actions:[],provider:'Gemini'}});
  });
  await page.locator('.chat-options summary').click();await page.locator('#voice-output-enabled').uncheck();await page.locator('.chat-options summary').click();
  await page.locator('#voice-text').fill('birds');await page.locator('#voice-text-send').click();
  await page.locator('#voice-retry').waitFor();assert.equal(await page.locator('#voice-retry').textContent(),'重新发送');
  assert.equal(await page.locator('#voice-text').inputValue(),'birds');await page.locator('#voice-retry').click();
  await page.waitForFunction(()=>document.getElementById('voice-text').value==='');assert.equal(sent,2);
  pass('failed text remains in the input and retry resends that sentence successfully');
  await page.getByRole('link',{name:'跳过教程',exact:true}).click();await page.locator('#player-name').waitFor();
  await page.screenshot({path:out+'/04-lobby.png'});
  await page.goto(base+'/hotel/?silent=1');await page.locator('#case-envelope').waitFor();
  await page.screenshot({path:out+'/05-envelope.png'});
  assert.equal(await page.locator('#start').isVisible(),false);assert.equal(await page.locator('#chat').isVisible(),false);
  await page.locator('#case-envelope').click();await page.locator('#case-letter').waitFor();
  assert.match(await page.locator('#case-letter').innerText(),/Three witnesses|Three|three witnesses/);
  assert.equal(await page.locator('.tutorial').count(),0);
  await page.screenshot({path:out+'/06-letter.png',fullPage:true});
  await page.locator('#case-close').click();await page.locator('#case-envelope').click();await page.locator('#start').click();
  await page.locator('#chat').waitFor();
  await page.waitForFunction(()=>!document.getElementById('send').disabled);
  const hotelPalette=await page.locator('#send').evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontFamily,radius:s.borderRadius,color:s.color,bg:s.backgroundColor};});
  assert.deepEqual(hotelPalette,palette);
  await page.screenshot({path:out+'/07-hotel-play.png'});
  pass('envelope opens the full brief before investigation; tutorial and hotel controls share the same theme');
  await page.locator('#settings-toggle').click();await page.screenshot({path:out+'/08-hotel-settings.png'});await page.locator('#settings-toggle').click();
  for(const route of ['/tutorial/','/hotel/']){
   await page.setViewportSize({width:390,height:844});await page.goto(base+route+'?silent=1');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:out+(route.startsWith('/hotel')?'/09-envelope-mobile.png':'/10-tutorial-mobile.png')});
   if(route.startsWith('/hotel')){
    await page.locator('#case-envelope').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#start').click();await page.locator('#chat').waitFor();
    await page.screenshot({path:out+'/11-hotel-mobile.png'});
   }
  }
  await page.setViewportSize({width:1280,height:540});await page.goto(base+'/?chapter=title&silent=1');
  await opening.locator('#ue-heading').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2));
  pass('390px chapters and the short opening fit without horizontal overflow or excess iframe height');
  assert.deepEqual(report.errors,[]);pass('all visited states have no page errors or missing resources');
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync(out+'/ui-browser.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
