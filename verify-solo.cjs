// Real single-player flow; no network transport mock, no sound or provider calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18779';
const out='validation/solo';fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
  const errors=[],network=[],checks=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:850},permissions:[],reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(base).origin||/^\/(api|v1)\//.test(url.pathname)){network.push(url.pathname);return route.abort();}
      return route.continue();
    });
    await context.addInitScript(()=>{
      window.testPad={id:'Xbox Wireless Controller (test)',connected:true,index:0,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
      Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/?mode=solo&silent=1&qa=1');
    await page.locator('#solo-setup').waitFor({state:'visible',timeout:4000});
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('solo-setup')).opacity==='1');
    await page.screenshot({path:out+'/roles-desktop.png'});
    const state=()=>page.evaluate(()=>window.__unseen.state());
    for(const role of ['survivor','hunter']){
      await page.locator(`[data-solo-role="${role}"]`).click();
      await page.waitForFunction(role=>window.__unseen?.state().phase==='chase'&&window.__unseen.state().room.game.role===role&&window.__unseen.state().audio.running,role);
      await page.waitForFunction(()=>window.__unseen.state().room.game.headstartSeconds===0);
      assert.equal(await page.locator('#partner-wait').isVisible(),false);
      const before=(await state()).pose;
      await page.evaluate(()=>{window.testPad.axes=[0,0,1,0];});await page.waitForTimeout(160);
      await page.evaluate(()=>{window.testPad.axes=[0,0,0,0];});await page.waitForTimeout(350);
      assert.notEqual((await state()).pose.heading,before.heading);
      await page.keyboard.press('ArrowUp');await page.waitForTimeout(600);
      const moved=(await state()).pose;assert.notDeepEqual(moved,before);
      await page.keyboard.press('p');await page.waitForTimeout(100);
      const stopped=(await state()).pose;await page.keyboard.press('ArrowUp');await page.waitForTimeout(400);
      assert.deepEqual((await state()).pose,stopped);await page.keyboard.press('p');
      await page.waitForFunction(()=>!window.__unseen.state().paused);
      await context.setOffline(true);await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);
      assert.notEqual((await state()).pose.heading,stopped.heading);
      await page.keyboard.press('p');
      await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
      await page.keyboard.press('p');await page.waitForFunction(()=>!window.__unseen.state().paused);
      const restored=(await state()).pose.heading;await page.keyboard.press('ArrowLeft');await page.waitForTimeout(350);
      assert.notEqual((await state()).pose.heading,restored,'offline cached-page restoration resumes local input');
      await context.setOffline(false);
      await page.screenshot({path:out+`/${role}.png`});
      await page.locator('#solo-reselect').click();await page.locator('#solo-setup').waitFor({state:'visible'});
      assert.equal((await state()).room.game,null);checks.push(role+' enters alone, controller/keyboard move, pause, offline and reselect');
    }
    await page.locator('[data-solo-role="survivor"]').click();await page.waitForFunction(()=>window.__unseen.state().audio.running);
    for(let i=0;i<5;i++){await page.keyboard.press('e');await page.waitForTimeout(100);}
    await page.waitForFunction(()=>window.__unseen.state().phase==='chase-result');
    await page.locator('#rematch').click();await page.locator('#solo-setup').waitFor({state:'visible'});
    checks.push('five-attempt result and immediate rematch without second player');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('solo-setup')).opacity==='1');
    await page.screenshot({path:out+'/roles-mobile.png'});
    await page.locator('[data-language="zh"]').click();
    await page.screenshot({path:out+'/roles-mobile-zh.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    checks.push('narrow layout and no API/external requests or browser errors');
    fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,network},null,2)+'\n');
    console.log(checks.join('\n'));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
