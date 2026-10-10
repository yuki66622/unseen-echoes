// Isolated loopback checks: no browser, audio, credentials, or provider requests.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,copyFile,cp,symlink,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('.',import.meta.url));
await mkdir(root+'validation',{recursive:true});
const fixture=await mkdtemp(root+'validation/dev-runtime-');
let active;
async function freePort(){
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}
async function until(check,message,timeout=10000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await check())return;await delay(100);}
  throw Error(message);
}
let port,inspectorPort;
async function response(path){
  try{const r=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(500)});return `${r.status}:${await r.text()}`;}
  catch{return '';}
}
function start(args=[]){
  const child=spawn(process.execPath,[fixture+'/local/dev.mjs','--inspector-port',String(inspectorPort),...args],{
    cwd:fixture,detached:true,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,XDG_CONFIG_HOME:fixture+'/config',TMPDIR:process.env.TMPDIR,WRANGLER_LOG_PATH:fixture+'/wrangler.log',WRANGLER_SEND_METRICS:'false',CI:'true'},
  });
  const runtime={child,logs:'',exit:new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{runtime.logs=(runtime.logs+chunk).slice(-16000);});
  active=runtime;return runtime;
}
async function checkExit(runtime,expected){
  let timeout;
  const result=await Promise.race([runtime.exit,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Development process did not exit.')),10000);})]).finally(()=>clearTimeout(timeout));
  assert.equal(result.code,expected,JSON.stringify(result));
  await until(()=>{try{process.kill(-runtime.child.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},'A development child process survived shutdown.');
  assert.equal(await response('/value'),'','Development port is still open.');
  active=null;
}
try{
  port=await freePort();inspectorPort=await freePort();
  for(const path of ['local','src','public/multiplayer','spacetimedb/src'])await mkdir(fixture+'/'+path,{recursive:true});
  await symlink(root+'node_modules',fixture+'/node_modules','dir');
  for(const name of ['dev.mjs','build-solo.mjs','solo-session.mjs'])await copyFile(root+'local/'+name,fixture+'/local/'+name);
  await cp(root+'spacetimedb/src',fixture+'/spacetimedb/src',{recursive:true});
  await writeFile(fixture+'/.dev.vars','');
  await writeFile(fixture+'/src/value.mjs','export default "before";\n');
  await writeFile(fixture+'/public/shared.mjs','export default "shared-before";\n');
  await writeFile(fixture+'/src/worker.mjs','import value from "./value.mjs"; import shared from "../public/shared.mjs"; export default {fetch(request,env){return new URL(request.url).pathname==="/value"?new Response(value+":"+shared):env.ASSETS.fetch(request)}};\n');
  await writeFile(fixture+'/public/index.html','<!doctype html><title>Runtime check</title>');
  const config=JSON.parse(await readFile(root+'wrangler.jsonc','utf8'));config.dev={...config.dev,port};
  await writeFile(fixture+'/wrangler.jsonc',JSON.stringify(config));
  let runtime=start();
  await until(async()=>await response('/value')==='200:before:shared-before','Development server did not start.',20000);
  await writeFile(fixture+'/public/added.txt','added-now');
  await until(async()=>await response('/added.txt')==='200:added-now','New asset stayed unavailable.');
  console.log('PASS new static assets become available without restarting');
  await writeFile(fixture+'/src/value.mjs','export default "after";\n');
  await until(async()=>await response('/value')==='200:after:shared-before','Worker import did not refresh.');
  await writeFile(fixture+'/public/shared.mjs','export default "shared-after";\n');
  await until(async()=>await response('/value')==='200:after:shared-after','Shared public Worker import did not refresh.');
  console.log('PASS Worker and shared public imports rebuild');
  const solo=fixture+'/local/solo-session.mjs',rules=fixture+'/spacetimedb/src/rules.ts';
  await writeFile(solo,(await readFile(solo,'utf8')).replace("this.identity = 'local-player'","this.identity = 'local-player-watch-check'"));
  await until(async()=>(await response('/multiplayer/solo.bundle.mjs')).includes('local-player-watch-check'),'Solo adapter did not refresh.');
  await writeFile(rules,(await readFile(rules,'utf8')).replace('export const STEP_MS = 50;','export const STEP_MS = 51;'));
  await until(async()=>(await response('/multiplayer/solo.bundle.mjs')).includes('STEP_MS = 51'),'Imported solo rules did not refresh.');
  console.log('PASS solo adapter and rule dependencies rebuild');
  runtime.child.kill('SIGTERM');await checkExit(runtime,143);
  runtime=start();
  await until(async()=>await response('/value')==='200:after:shared-after','Development server did not restart.',20000);
  runtime.child.kill('SIGINT');await checkExit(runtime,130);
  console.log('PASS SIGTERM and SIGINT release the port and all child processes');
  runtime=start(['--unseen-invalid-option']);await checkExit(runtime,1);
  await writeFile(solo,'export const = ;');
  runtime=start();await checkExit(runtime,1);
  console.log('PASS failed Wrangler startup and initial compilation clean up');
}catch(error){
  if(active)console.error(active.logs.split('\n').filter(line=>/error|failed|invalid|ready|address|port/i.test(line)).slice(-12).join('\n'));
  throw error;
}finally{
  if(active){try{process.kill(-active.child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await active.exit;}
  await rm(fixture,{recursive:true,force:true});
}
