const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786',out=process.env.QA_OUTPUT||'validation/final-polish/layout';
fs.mkdirSync(out,{recursive:true});const report={base,checks:[],errors:[]};
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},permissions:[],reducedMotion:'reduce'});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base+'/?chapter=title&silent=1');const opening=page.frameLocator('#opening-frame');
  await opening.locator('#ue-next').click();await opening.locator('#ue-heading').click();await opening.locator('[data-step="2"][data-transitioning="false"]').waitFor();
  assert.equal(await opening.locator('#ue-heading').textContent(),'你在一个架空的空间醒来。');assert.equal(await opening.locator('#ue-body').textContent(),'面前，立着许多扇门。');
  await opening.locator('#ue-skip').click();await opening.locator('[data-scene="tutorial"][data-transitioning="false"]').waitFor();
  for(const [width,height]of [[1440,900],[1024,768],[390,844],[844,390],[320,568]]){
   await page.setViewportSize({width,height});
   const center=width/2,boxes=await Promise.all(['#ue-eyebrow','#ue-heading','#ue-body','#tutorial-entry','#ue-footer-note'].map(sel=>opening.locator(sel).boundingBox()));
   for(const box of boxes){assert.ok(box);assert.ok(Math.abs(box.x+box.width/2-center)<2,`Centered text/action at ${width}x${height}`);}
   const replay=await opening.locator('#ue-replay').boundingBox(),skip=await opening.locator('#skip-tutorial').boundingBox(),cta=boxes[3];
   assert.ok(!overlaps(replay,skip));assert.ok(!overlaps(cta,skip));assert.ok(!overlaps(cta,replay));
   for(const box of [replay,skip,cta])assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
   await page.screenshot({path:`${out}/opening-${width}x${height}.png`});report.checks.push(`Opening heading, body, CTA and footer aligned without overlap at ${width}x${height}`);
  }
  await page.setViewportSize({width:1440,height:900});await opening.locator('#tutorial-entry').click();await page.locator('#start').click();await page.locator('body.has-entered').waitFor();
  for(const [width,height]of [[1440,900],[1024,768],[390,844],[844,390],[320,568]]){
   await page.setViewportSize({width,height});await page.locator('#trail-map[data-revealed="true"]').waitFor();
   const map=await page.locator('#trail-map').boundingBox(),compass=await page.locator('#orientation').boundingBox(),keys=await page.locator('.key-legend').boundingBox();
   assert.ok(!overlaps(map,compass),`Map/compass do not overlap at ${width}`);assert.ok(!overlaps(map,keys),`Map/key legend do not overlap at ${width}`);
   const chat=await page.locator('#voice-control').boundingBox();
   for(const box of [map,compass,keys]){assert.ok(!overlaps(box,chat),`Navigation/chat do not overlap at ${width}x${height}`);assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);}
   assert.equal(await page.locator('#chat-body').isVisible(),false);await page.screenshot({path:`${out}/tutorial-${width}x${height}.png`});
   await page.keyboard.press('p');await page.locator('#chat-collapsed-status').waitFor();
   const pausedChat=await page.locator('#voice-control').boundingBox();for(const box of [map,compass,keys])assert.ok(!overlaps(box,pausedChat),`Paused navigation/chat do not overlap at ${width}x${height}`);
   await page.keyboard.press('p');
   report.checks.push(`Tutorial map, compass, keys and collapsed Gemini at ${width}x${height}`);
  }
  assert.deepEqual(report.errors,[]);for(const check of report.checks)console.log('PASS '+check);
 }catch(error){report.failure=error.stack;throw error;}finally{fs.writeFileSync(out+'/layout.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
