import {probeRoomService} from './connection-probe.bundle.mjs';

const labels={local:'游戏入口',computer:'游戏服务到对局服务器',https:'浏览器访问联机入口',identity:'已保存的玩家身份',realtime:'实时连接与房间同步'};
const validCode=new Set(['reachable','http-error','dns-error','tls-error','timeout','network-error','ready','handshake-failed','socket-closed','subscription-rejected','browser-unsupported','not-needed','accepted','rejected','unknown']);
const statusOf=value=>Number.isInteger(value)&&value>=100&&value<=599?value:undefined;
async function timedFetch(fetchImpl,url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{return await fetchImpl(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
}

export async function runConnectionChecks(config,token,{fetchImpl=fetch,probe=probeRoomService,onResult=()=>{}}={}){
  const endpoint=new URL(config.uri);endpoint.protocol=endpoint.protocol==='wss:'?'https:':endpoint.protocol==='ws:'?'http:':endpoint.protocol;
  const result={version:2,hosting:config.hosting||'local',build:config.clientBuild||'旧版本',server:endpoint.host,database:config.database,checks:[]};
  const record=(id,data)=>{const safe={id,ok:!!data.ok,code:validCode.has(data.code)?data.code:'unknown'};const status=statusOf(data.status);if(status)safe.status=status;if(['websocket','subscription'].includes(data.stage))safe.stage=data.stage;result.checks.push(safe);onResult(safe);};
  record('local',{ok:true,code:'reachable'});
  await Promise.all([
    (async()=>{try{const response=await timedFetch(fetchImpl,'/api/connection-check');if(!response.ok)throw Error();record('computer',await response.json());}catch{record('computer',{ok:false,code:'network-error'});}})(),
    (async()=>{try{const response=await timedFetch(fetchImpl,new URL(`v1/database/${config.database}/identity`,endpoint));record('https',{ok:response.ok,status:response.status,code:response.ok?'reachable':'http-error'});}catch{record('https',{ok:false,code:'network-error'});}})(),
    (async()=>{if(!token)return record('identity',{ok:true,code:'not-needed'});try{const response=await timedFetch(fetchImpl,new URL('v1/identity/websocket-token',endpoint),{method:'POST',headers:{Authorization:`Bearer ${token}`}});record('identity',{ok:response.ok,status:response.status,code:response.ok?'accepted':response.status===401||response.status===403?'rejected':'http-error'});/* Do not read, persist or report the returned temporary credential. */}catch{record('identity',{ok:false,code:'network-error'});}})(),
    (async()=>{try{record('realtime',await probe(config));}catch{record('realtime',{ok:false,code:'browser-unsupported'});}})(),
  ]);
  result.checks.sort((a,b)=>Object.keys(labels).indexOf(a.id)-Object.keys(labels).indexOf(b.id));
  result.conclusion=diagnosticConclusion(result);
  return result;
}

export function diagnosticConclusion(report){
  const checks=Object.fromEntries(report.checks.map(item=>[item.id,item]));
  if(checks.identity?.code==='rejected')return '保存的玩家身份被服务器拒绝。请把检测结果发回来；不要反复重试或删除浏览器数据。';
  if(checks.computer?.ok===false&&checks.https?.ok===false)return report.hosting==='cloud'?'云端入口和浏览器都未能连接对局服务。请复制结果，暂不能把原因归于你的电脑。':'这台电脑目前无法访问公网游戏服务。请用手机热点再检测一次，对比是否与当前网络有关。';
  if(checks.computer?.ok&&checks.https?.ok===false)return '游戏服务可达，但这个浏览器的请求没有通过。请复制检测结果。';
  if(checks.https?.ok&&checks.realtime?.ok===false)return checks.realtime.stage==='subscription'?'实时连接已建立，但房间同步失败。请复制检测结果。':'普通网页请求成功，实时连接未成功。请复制检测结果；目前还不能判断是浏览器还是网络限制。';
  if(checks.identity?.ok===false)return '已保存的玩家身份未能完成校验。请复制检测结果。';
  if(checks.realtime?.ok)return '实时连接和房间同步通过，可以创建或加入房间。如果页面仍显示断开，请点“重新连接”；仍失败时复制结果。';
  return '检测尚未确定失败原因，请复制结果。';
}

function description(item){
  if(item.ok)return item.code==='not-needed'?'尚无保存的身份，无需检查':'通过';
  return ({'dns-error':'域名解析失败','tls-error':'安全连接未通过','timeout':'连接超时','rejected':'身份被拒绝','subscription-rejected':'房间同步被拒绝','handshake-failed':'实时连接未建立','socket-closed':'实时连接关闭','browser-unsupported':'浏览器未能启动连接'}[item.code]||'未通过')+(item.status?`（${item.status}）`:'');
}

export class ConnectionCheck{
  constructor({getConfig,getToken,getNetworkState}){
    this.dependencies={getConfig,getToken,getNetworkState};this.running=false;this.report=null;
    document.getElementById('run-connection-check').addEventListener('click',()=>void this.run());
    document.getElementById('copy-connection-check').addEventListener('click',()=>void this.copy());
  }
  async run(){
    if(this.running)return;this.running=true;this.report=null;
    const button=document.getElementById('run-connection-check'),list=document.getElementById('connection-check-results'),summary=document.getElementById('connection-check-summary');
    button.disabled=true;button.textContent='正在检测…';list.replaceChildren();summary.textContent='分别检查电脑、浏览器、玩家身份和实时连接，约需十几秒。';document.getElementById('copy-connection-check').hidden=true;document.getElementById('connection-check-copy').hidden=true;
    try{
      const config=await this.dependencies.getConfig();document.getElementById('client-build').textContent=`联机版本 ${config.clientBuild||'旧版本'}`;
      this.report=await runConnectionChecks(config,this.dependencies.getToken(),{onResult:item=>{const li=document.createElement('li');li.textContent=`${labels[item.id]}：${description(item)}`;list.append(li);}});
      const state=this.dependencies.getNetworkState()||{};this.report.current={state:state.state,stage:state.stage,reason:state.reason};
      const ua=navigator.userAgent;this.report.browser=(ua.match(/(?:Edg|Chrome|Firefox)\/\d+/)||ua.match(/Version\/\d+.*Safari/)||['未知浏览器'])[0];
      summary.textContent=this.report.conclusion;document.getElementById('copy-connection-check').hidden=false;
    }catch{summary.textContent='游戏入口暂时不可用，请刷新页面后重试。';}
    finally{this.running=false;button.disabled=false;button.textContent='重新检测';}
  }
  async copy(){
    if(!this.report)return;const text=JSON.stringify(this.report,null,2);
    try{await navigator.clipboard.writeText(text);document.getElementById('connection-check-summary').textContent='检测结果已复制，可以发回来定位问题。';}
    catch{const field=document.getElementById('connection-check-copy');field.value=text;field.hidden=false;field.focus();field.select();}
  }
}
