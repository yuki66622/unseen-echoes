// Local, muted browser integration. Gamepads and transport are simulated;
// chapter code, physics, audio graph, and authoritative chase rules are real.
// Every non-local request is blocked and every provider endpoint is stubbed.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18779';
const out=process.env.QA_OUTPUT||'validation/gamepad';
fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],externalRequests:[],hardware:'simulated; physical controller not verified'};
const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
(async()=>{
  const rules=await import('./spacetimedb/src/rules.ts');
  const {compileBilingualPlan}=await import('./public/world/world-plan.mjs');
  const text={zh:'雨声检查',en:'Rain check'};
  const envelope={id:'0123456789abcdef0123456789abcdef',createdAt:'2026-10-01T00:00:00Z',origin:'fixture',model:'offline-fixture',
    ...compileBilingualPlan({title:text,introduction:text,completion:text,layout:'procession',width:12,height:10,doorPosition:'middle',rainRoom:'south-east',swapOtherSounds:false,descriptions:{rain:text,forest:text,fire:text}},'en')};
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
  let chase=null;const calls=[];
  const advance=()=>{if(chase)rules.advanceChase(chase,performance.now());};
  const timer=setInterval(advance,25);
  try{
    const context=await browser.newContext({viewport:{width:1280,height:850},permissions:[],reducedMotion:'reduce'});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(base).origin){report.externalRequests.push(url.origin);return route.abort();}
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{configured:false,speechConfigured:false,hosting:'cloud',csrf:'offline-test'}});
      if(url.pathname==='/multiplayer/network.bundle.mjs')return route.fulfill({contentType:'text/javascript',body:`
        export class RoomConnection {
          constructor(config,onRoom,onStatus){this.onRoom=onRoom;this.onStatus=onStatus;this.identity='survivor-id';this.ready=false;}
          async connect(){this.ready=true;this.onStatus('Connected',{state:'connected'});await this.snapshot();this.timer=setInterval(()=>this.snapshot(),50);}
          async snapshot(){if(this.ready)this.onRoom(await window.testTransport('snapshot'));}
          async call(kind,args){await window.testTransport(kind,args);await this.snapshot();}
          disconnect(){this.ready=false;clearInterval(this.timer);}
          resume(){} reconnect(){return this.connect();} goOffline(){this.disconnect();}
        }`});
      return route.continue();
    });
    await context.addInitScript(()=>{
      window.testPad={id:'Xbox Wireless Controller (test)',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
      Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPad?[window.testPad]:[]});
    });
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.exposeBinding('testTransport',async(_,kind,args)=>{
      advance();
      if(kind==='input'){calls.push(args);rules.applyInput(chase,'survivor-id',args,performance.now());}
      const game=rules.snapshotFor(chase,'survivor-id',performance.now());
      return {code:'PAD123',mode:'chase',host:'survivor-id',phase:chase.outcome?'finished':'running',game,members:[{identity:'survivor-id',name:'Tester',role:'survivor',ready:true,online:true},{identity:'hunter-id',name:'Partner',role:'hunter',ready:true,online:true}]};
    });
    const axes=async(values)=>{await page.evaluate(values=>{window.testPad.axes=values;},values);};
    const neutral=async()=>{await page.evaluate(()=>{window.testPad.axes=[0,0,0,0];window.testPad.buttons.forEach(b=>{b.pressed=false;b.value=0;});});await page.waitForTimeout(90);};
    const button=async(index,hold=100)=>{await page.evaluate(i=>{window.testPad.buttons[i]={pressed:true,value:1};},index);await page.waitForTimeout(hold);await page.evaluate(i=>{window.testPad.buttons[i]={pressed:false,value:0};},index);await page.waitForTimeout(90);};
    const stable=async(read,delay=350)=>{const before=await read();await page.waitForTimeout(delay);assert.deepEqual(await read(),before);};
    const tutorialPose=()=>page.locator('#player').getAttribute('transform');
    const hotelState=()=>page.locator('#qa-state').textContent().then(JSON.parse);
    await page.goto(base+'/controller/');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已识别'));
    await axes([0,-1,0,0]);await page.waitForFunction(()=>document.getElementById('action').textContent.includes('前进'));
    await neutral();assert.equal(await page.locator('#action').textContent(),'已停止');
    await page.screenshot({path:out+'/controller-desktop.png'});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/controller-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1280,height:850});pass('silent input check displays live axes, releases, and narrow layout');

    await page.goto(base+'/tutorial/?silent=1&seed=5');await page.locator('#start').click();await page.locator('body.has-entered').waitFor();await neutral();
    const before=await tutorialPose();await axes([0,-1,0,0]);await page.waitForTimeout(260);await neutral();assert.notEqual(await tutorialPose(),before);await stable(tutorialPose);
    const heading=await tutorialPose();await axes([0,0,1,0]);await page.waitForTimeout(200);await neutral();assert.notEqual(await tutorialPose(),heading);
    await axes([0,-1,0,0]);await page.waitForTimeout(100);await button(9);await page.waitForTimeout(100);await stable(tutorialPose);
    await neutral();await button(9);await neutral();
    await axes([0,0,-1,0]);await page.waitForTimeout(90);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await stable(tutorialPose);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await stable(tutorialPose,150);await neutral();
    // BFCache pagehide must not permanently destroy the input adapter.
    await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    await neutral();const restored=await tutorialPose();await axes([0,0,1,0]);await page.waitForTimeout(160);await neutral();assert.notEqual(await tutorialPose(),restored);
    await page.screenshot({path:out+'/tutorial.png'});pass('tutorial moves/turns, centers, pauses, handles blur and survives cached navigation');

    await page.goto(base+'/hotel/?silent=1&debug=1');await page.locator('#case-envelope').click();await page.locator('#start').click();await page.locator('#chat').waitFor();await neutral();
    const hotelBefore=(await hotelState()).player;await axes([0,0,1,0]);await page.waitForTimeout(350);await neutral();await page.waitForTimeout(180);assert.notEqual((await hotelState()).player.heading,hotelBefore.heading);
    await stable(async()=>(await hotelState()).player);
    const attempts=(await hotelState()).searchAttempts;await button(0,900);await page.waitForTimeout(200);assert.equal((await hotelState()).searchAttempts,attempts+1);
    await page.locator('#message').focus();const typing=(await hotelState()).player;await axes([0,0,1,0]);await page.waitForTimeout(400);assert.deepEqual((await hotelState()).player,typing);
    await page.locator('#message').evaluate(el=>el.blur());await stable(async()=>(await hotelState()).player,150);await neutral();
    await page.locator('#settings-toggle').click();await page.locator('.gamepad-help summary').click();await page.locator('#settings-toggle').click();await neutral();
    const settingsClosed=(await hotelState()).player.heading;await axes([0,0,-1,0]);await page.waitForTimeout(200);await neutral();await page.waitForTimeout(180);assert.notEqual((await hotelState()).player.heading,settingsClosed);
    await page.screenshot({path:out+'/hotel.png'});pass('hotel movement, single interaction per held A, typing guard and settings recovery');

    await page.goto(base+'/world/?silent=1&qa=1');await page.waitForFunction(()=>Boolean(window.__world));
    await page.evaluate(entry=>window.__world.select(entry),envelope);await page.locator('#enter-world').click();await page.waitForFunction(()=>window.__world.state().scene==='play');await neutral();
    const worldPose=()=>page.evaluate(()=>window.__world.state().run.player);
    const worldBefore=await worldPose();await axes([0,0,1,0]);await page.waitForTimeout(200);await neutral();assert.notEqual((await worldPose()).heading,worldBefore.heading);
    await axes([0,-1,0,0]);await page.waitForTimeout(100);await page.evaluate(()=>{window.testPad.connected=false;});await page.waitForTimeout(100);await stable(worldPose);
    await page.evaluate(()=>{window.testPad.connected=true;});await stable(worldPose,160);await neutral();
    await button(9);assert.equal(await page.evaluate(()=>window.__world.state().scene),'paused');await button(9);await page.waitForFunction(()=>window.__world.state().scene==='play');await neutral();
    await page.screenshot({path:out+'/world.png'});pass('saved world supports turning, disconnect/reconnect neutral guard and Menu pause/resume');

    chase=rules.createChase('gamepad-round',[{id:'survivor-id',role:'survivor',online:true},{id:'hunter-id',role:'hunter',online:true}],performance.now());
    await page.goto(base+'/?chapter=lobby&silent=1&qa=1');await page.waitForFunction(()=>window.__unseen?.state().phase==='chase'&&window.__unseen.state().audio.running);await neutral();
    const chasePose=()=>page.evaluate(()=>window.__unseen.state().pose);
    const chaseBefore=await chasePose();await axes([0,-1,0,0]);await page.waitForTimeout(850);await neutral();await page.waitForTimeout(180);
    const chaseAfter=await chasePose();assert.ok(chaseAfter.y>chaseBefore.y+.5);assert.ok(chaseAfter.y<chaseBefore.y+1.1);await stable(chasePose);
    assert.equal(calls.at(-1).kind,'stop');
    const moveCalls=calls.filter(c=>c.kind==='move').length;assert.ok(moveCalls>=2&&moveCalls<=3);
    const attemptsBefore=rules.snapshotFor(chase,'survivor-id',performance.now()).attemptsRemaining;
    await button(0,950);assert.equal(calls.filter(c=>c.kind==='interact').length,1);assert.equal(rules.snapshotFor(chase,'survivor-id',performance.now()).attemptsRemaining,attemptsBefore-1);
    await axes([0,0,1,0]);await page.waitForTimeout(120);await button(1);await page.waitForTimeout(180);await stable(chasePose);await neutral();
    await page.screenshot({path:out+'/chase.png'});pass('multiplayer controller commands obey real chase rules, speed, stop barrier and one-attempt interaction');
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
    pass('no browser errors or external/provider requests');
  }finally{clearInterval(timer);await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
