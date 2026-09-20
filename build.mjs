import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const files=[];
function walk(directory){for(const item of readdirSync(directory,{withFileTypes:true})){const path=`${directory}/${item.name}`;if(item.isDirectory())walk(path);else if(item.isFile())files.push(path);else throw Error('Only regular application files are allowed');}}
walk('public');
const hash=createHash('sha256');
for(const path of [...files,'src/worker.mjs','connection.json'].sort()){hash.update(path);hash.update(readFileSync(path));}
const buildId=hash.digest('hex').slice(0,12);
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
cpSync('public','dist/client',{recursive:true});
cpSync('.openai/hosting.json','dist/.openai/hosting.json');
await build({entryPoints:['src/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',define:{__BUILD_ID__:JSON.stringify(buildId)}});
writeFileSync('dist/build.json',JSON.stringify({buildId,assets:files.length})+'\n');
console.log(`Built cloud game: ${buildId}; ${files.length} public files`);
