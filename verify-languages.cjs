const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786',out=process.env.QA_OUTPUT||'validation/languages';
fs.mkdirSync(out,{recursive:true});const report={base,checks:[],errors:[],untranslated:[]};
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const pass=x=>{report.checks.push(x);console.log('PASS '+x);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:[],reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const scan=async(target,label)=>{const missing=await target.evaluate(()=>{const found=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode,p=n.parentElement;if(/[\u3400-\u9fff]/u.test(n.data)&&p.getClientRects().length&&!p.closest('script,style,[hidden],[data-no-localize],#language-switch,#debug,#qa-state,textarea,output'))found.push(n.data.trim());}return [...new Set(found)];});if(missing.length)report.untranslated.push({label,missing});};
  const english=async()=>{await page.locator('#language-switch [data-language=en]').click();await page.waitForFunction(()=>document.documentElement.lang==='en');await page.waitForTimeout(150);};
  await page.goto(base+'/?chapter=title&silent=1&qa=1');await page.locator('#language-switch').waitFor();await english();
  const opening=page.frameLocator('#opening-frame');await opening.locator('#ue-heading').filter({hasText:'Unseen Echoes'}).waitFor();
  for(let n=0;n<7;n++){await scan(await (await page.locator('#opening-frame').elementHandle()).contentFrame(),'opening '+n);await opening.locator('#ue-next').click();await page.waitForTimeout(180);}
  await opening.locator('#tutorial-entry').waitFor();await scan(await (await page.locator('#opening-frame').elementHandle()).contentFrame(),'tutorial intro');
  await page.waitForFunction(()=>window.__menuAudio?.state().currentTime>0);assert.equal(await page.evaluate(()=>window.__menuAudio.state().volume),0);pass('English opening covers every passage and menu rain plays silently after a click');
  for(const [w,h]of [[1440,900],[390,844],[844,390],[320,568]]){await page.setViewportSize({width:w,height:h});await page.screenshot({path:`${out}/opening-${w}.png`});}
  await opening.locator('#tutorial-entry').click();await page.locator('html[lang=en][data-locale-ready=true]').waitFor();await page.locator('#start').click();await page.locator('body.has-entered').waitFor();await page.waitForTimeout(200);
  assert.equal(await page.locator('#chat-body').isVisible(),false);await scan(page,'tutorial');
  const before=await page.locator('#coords').textContent();await page.keyboard.press('ArrowUp');await page.waitForTimeout(550);const moved=await page.locator('#coords').textContent();assert.notEqual(moved,before);
  await page.locator('#language-switch [data-language=zh]').click();await page.waitForTimeout(80);assert.equal(await page.locator('#coords').textContent(),moved);await english();assert.equal(await page.locator('#coords').textContent(),moved);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.menuAudio),'off');pass('Language persists into tutorial, preserves position and does not restart its soundscape');
  for(const [w,h]of [[1440,900],[390,844],[844,390],[320,568]]){
   await page.setViewportSize({width:w,height:h});await page.waitForTimeout(100);const boxes=await Promise.all(['#language-switch','#trail-map','#orientation','#play-panel','#voice-control'].map(s=>page.locator(s).boundingBox()));
   for(let i=0;i<boxes.length;i++)assert.ok(boxes[i].y>=0&&boxes[i].y+boxes[i].height<=h+1,`Tutorial panel ${i} stays inside ${w}x${h}: ${JSON.stringify(boxes[i])}`);
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(!overlap(boxes[i],boxes[j]),`No overlap ${i}/${j} at ${w}x${h}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/tutorial-${w}.png`});
  }pass('English tutorial switch, map, compass, controls and Gemini fit desktop/mobile/landscape');
  await page.setViewportSize({width:1280,height:850});await page.goto(base+'/?chapter=lobby&silent=1&qa=1');await page.locator('html[lang=en][data-locale-ready=true]').waitFor();await page.waitForTimeout(300);await scan(page,'lobby name');
  await page.locator('#player-name').fill('等待加入');await page.locator('#profile-form button').click();await page.waitForTimeout(150);await scan(page,'lobby choice');assert.equal(await page.locator('#profile-name').textContent(),'等待加入');
  await page.locator('#create-room').click();await page.locator('#active-code').waitFor();await page.waitForTimeout(500);await scan(page,'room');assert.equal(await page.locator('#roster strong').first().textContent(),'等待加入');pass('English room flow preserves player names and room codes');
  await page.goto(base+'/hotel/?silent=1&debug=1');await page.locator('html[lang=en][data-locale-ready=true]').waitFor();await scan(page,'hotel envelope');await page.locator('#case-envelope').click();await scan(page,'hotel letter');await page.locator('#start').click();await page.locator('#chat').waitFor();await page.waitForTimeout(400);await scan(page,'hotel play');
  await page.locator('#message').fill('等待加入');await page.locator('#language-switch [data-language=zh]').click();await page.waitForTimeout(100);assert.equal(await page.locator('#message').inputValue(),'等待加入');await english();
  const s=JSON.parse(await page.locator('#qa-state').textContent());assert.equal(s.trail.floors[0].distance,0);assert.equal(await page.evaluate(()=>window.__menuAudio.state().paused),true);pass('English hotel brief, game and language switch preserve entered text and investigation state');
  for(const [w,h]of [[1440,900],[390,844],[844,390],[320,568]]){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(160);await page.addStyleTag({content:'#debug{display:none!important}'});const sels=['#language-switch','#trail-map','#orientation','#play-panel','#chat'],boxes=await Promise.all(sels.map(s=>page.locator(s).boundingBox()));for(let i=0;i<boxes.length;i++){assert.ok(boxes[i].y>=0&&boxes[i].y+boxes[i].height<=h+1,`Hotel ${sels[i]} within ${w}x${h}: ${JSON.stringify(boxes[i])}`);for(let j=i+1;j<boxes.length;j++)assert.ok(!overlap(boxes[i],boxes[j]),`Hotel no overlap ${sels[i]}/${sels[j]} ${w}x${h}`);}await page.screenshot({path:`${out}/hotel-${w}.png`});}pass('Shared hotel orb, controls and map fit all four viewports');await page.setViewportSize({width:1440,height:900});await page.locator('#settings-toggle').click();await scan(page,'hotel settings');await page.screenshot({path:out+'/hotel.png'});
  assert.deepEqual(report.untranslated,[]);assert.deepEqual(report.errors,[]);pass('No untranslated Chinese authored UI or page errors in the checked English journey');
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
