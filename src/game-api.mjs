import {hotelReply} from './hotel-service.mjs';
import {tutorialReply} from './tutorial-service.mjs';

const encoder=new TextEncoder();
const cookieName='unseen_game_session';
const visitors=new Map(),speechCache=new Map();
let activeCalls=0;
const voices={guide:'EXAVITQu4vr4xnSDxMaL',martin:'FTNCalFNG5bRnkkaP5Ug',claire:'McVZB9hVxVSk3Equu8EH',elena:'gfKKsLN1k0oYYN9n2dXX',cleaner:'XrExE9yKIg1WjnnlVkGX'};
const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});}
function error(status,code,message){return json({error:{code,message}},status);}
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function hmac(data,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(data))));}
function sessionCookie(request){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function validSession(value,secret){if(!secret||value.length>240)return false;const parts=value.split('.');if(parts.length!==3||!/^\d+$/.test(parts[1])||Number(parts[1])<Date.now()||Number(parts[1])>Date.now()+43201000)return false;return equal(parts[2],await hmac(parts.slice(0,2).join('.'),secret));}
async function createSession(secret){const data=base64(crypto.getRandomValues(new Uint8Array(24)))+'.'+(Date.now()+43200000);return data+'.'+await hmac(data,secret);}
async function body(request,max=3300000){
  if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw {status:415,code:'format',message:'Please send a JSON game request.'};
  if(Number(request.headers.get('Content-Length')||0)>max)throw {status:413,code:'size',message:'That message is too large.'};
  const reader=request.body?.getReader();if(!reader)throw {status:400,code:'empty',message:'The message is empty.'};
  let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject({status:408,code:'upload_timeout',message:'The upload timed out. Please retry.'});void reader.cancel();},8000);});
  const chunks=[];let length=0;
  try{while(true){const {value,done}=await Promise.race([reader.read(),deadline]);if(done)break;length+=value.length;if(length>max){await reader.cancel();throw {status:413,code:'size',message:'That message is too large.'};}chunks.push(value);}}finally{clearTimeout(timer);reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw {status:400,code:'input',message:'The message format is invalid.'};}
}
function admit(request,token){
  const now=Date.now(),key=request.headers.get('CF-Connecting-IP')||token.split('.')[0];
  for(const [key,value]of visitors)if(now-value.start>3600000)visitors.delete(key);
  if(!visitors.has(key)){if(visitors.size>=2000)return false;visitors.set(key,{start:now,count:0,recent:[]});}
  const item=visitors.get(key);item.recent=item.recent.filter(t=>now-t<60000);
  if(item.count>=60||item.recent.length>=12||activeCalls>=2)return false;
  item.count++;item.recent.push(now);return true;
}
async function speak(payload,env,fetchImpl){
  if(!env.ELEVENLABS_API_KEY)throw {status:503,code:'speech_unavailable',message:'Spoken replies are unavailable. Your text reply is still available.'};
  const role=payload?.role||'guide';
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['text','role'].includes(k))||!Object.hasOwn(voices,role)||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>400)throw {status:400,code:'speech_input',message:'The spoken reply is invalid.'};
  const cacheKey=role+':'+payload.text;
  if(speechCache.has(cacheKey))return new Response(speechCache.get(cacheKey),{headers:{...headers,'Content-Type':'audio/mpeg'}});
  const response=await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voices[role]}?output_format=mp3_44100_128`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json','Accept':'audio/mpeg'},
    body:JSON.stringify({text:payload.text,model_id:'eleven_flash_v2_5',voice_settings:{stability:.6,similarity_boost:.75}})});
  if(!response.ok){await response.body?.cancel();throw {status:502,code:'speech_provider',message:'The spoken reply could not be generated. Your text reply is still available.'};}
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>2000000){await reader.cancel();throw Error('audio size');}chunks.push(value);}}finally{reader.releaseLock();}
  if(length<100)throw Error('incomplete audio');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(speechCache.size>=8)speechCache.delete(speechCache.keys().next().value);speechCache.set(cacheKey,bytes);
  return new Response(bytes,{headers:{...headers,'Content-Type':'audio/mpeg'}});
}

export async function gameApi(request,env,fetchImpl=fetch){
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/(tutorial|hotel)\/(status|interpret|speak)$/);
  if(!match)return null;
  const [,chapter,action]=match,origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return error(403,'origin','Open this request from the game itself.');
  if(action==='status'){
    if(request.method!=='GET')return error(405,'method','This request method is unsupported.');
    let token=sessionCookie(request),extra={};
    if(env.GAME_SESSION_SECRET&&!await validSession(token,env.GAME_SESSION_SECRET)){
      token=await createSession(env.GAME_SESSION_SECRET);
      extra['Set-Cookie']=`${cookieName}=${token}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=43200${url.protocol==='https:'?'; Secure':''}`;
    }
    return json({configured:!!env.GEMINI_API_KEY&&!!env.GAME_SESSION_SECRET,provider:'Gemini',model:env.GEMINI_MODEL||'gemini-3.1-flash-lite',local:false,understanding:true,speechOutput:!!env.ELEVENLABS_API_KEY,maxSeconds:12,csrfToken:env.GAME_SESSION_SECRET?token:'',chapter},200,extra);
  }
  if(request.method!=='POST')return error(405,'method','This request method is unsupported.');
  if(!env.GAME_SESSION_SECRET)return error(503,'not_configured','The conversation service is not configured. Recorded evidence remains available.');
  const token=request.headers.get('X-Voice-Token')||'';
  if(!token||!equal(token,sessionCookie(request))||!await validSession(token,env.GAME_SESSION_SECRET))return error(403,'session','Refresh the game to reconnect your conversation.');
  if(!admit(request,token))return error(429,'busy','Please wait a moment before sending another message. Exploration is still available.');
  let acquired=false;
  try{
    const payload=await body(request,action==='speak'?6000:3300000);
    if(activeCalls>=2)return error(429,'busy','Please wait a moment before sending another message. Exploration is still available.');
    activeCalls++;acquired=true;
    if(action==='speak')return await speak(payload,env,fetchImpl);
    const result=await (chapter==='hotel'?hotelReply:tutorialReply)(payload,env,fetchImpl);
    return json({...result,requestId:crypto.randomUUID(),provider:'Gemini',model:env.GEMINI_MODEL||'gemini-3.1-flash-lite'});
  }catch(e){const status=Number.isInteger(e.status)&&e.status>=400&&e.status<600?e.status:502;return error(status,e.code||'service_unavailable',e.code?e.message:'The reply could not be completed. No new action was executed; you can retry.');}
  finally{if(acquired)activeCalls--;}
}
