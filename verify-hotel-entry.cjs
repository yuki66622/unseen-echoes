const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.GAME_SITE_URL||'http://127.0.0.1:18786';
const out=process.env.QA_OUTPUT||'validation/rounds/entry';
fs.mkdirSync(out,{recursive:true});
const report={base,checks:[],errors:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
 let release;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:850},permissions:[],reducedMotion:'reduce'});
  page.on('pageerror',e=>report.errors.push(e.message));
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/hotel/app.mjs',async route=>{await gate;await route.continue();});
  await page.goto(base+'/hotel/?silent=1',{waitUntil:'commit'});
  await page.locator('#case-envelope').click();await page.locator('#case-letter').waitFor();
  assert.equal(await page.locator('#start').isDisabled(),true);
  assert.equal(await page.locator('#load-status').textContent(),'Loading the hotel…');
  report.checks.push('letter remains readable while game module is delayed; entry waits for readiness');
  release();await page.locator('#start').click();await page.locator('#chat').waitFor();
  assert.equal(await page.locator('#intro').isVisible(),false);
  assert.equal(await page.locator('#search-budget').textContent(),'Checks left 5 / 5');
  report.checks.push('one click enters after readiness with all five checks');
  assert.deepEqual(report.errors,[]);
  report.checks.push('delayed module entry has no browser errors');
  await page.screenshot({path:out+'/hotel-entry.png'});
  for(const name of report.checks)console.log('PASS '+name);
 }catch(error){report.failure=error.stack;throw error;}
 finally{release?.();fs.writeFileSync(out+'/hotel-entry.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
