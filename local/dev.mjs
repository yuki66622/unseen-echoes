import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {context} from 'esbuild';
import {soloBuild} from './build-solo.mjs';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const compiler=await context(soloBuild);
let wrangler,stopping=false;
async function stop(code){
  if(stopping)return;
  stopping=true;process.exitCode=code;
  wrangler?.kill('SIGTERM');
  await compiler.dispose();
}
process.once('SIGINT',()=>void stop(130));
process.once('SIGTERM',()=>void stop(143));
try{
  await compiler.watch();
  // Wait for a valid initial bundle before the game server starts.
  await compiler.rebuild();
  if(!stopping){
    wrangler=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),
      'dev','--local',...process.argv.slice(2)],{stdio:'inherit'});
    wrangler.once('error',error=>{console.error(error.message);void stop(1);});
    wrangler.once('exit',code=>void stop(code??1));
  }
}catch(error){
  console.error(error.message);await stop(1);
}
