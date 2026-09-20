import connection from '../connection.json' with {type:'json'};

const database=connection.database,upstream=new URL(connection.uri);
const identityPath=`/v1/database/${database}/identity`;
const subscribePath=`/v1/database/${database}/subscribe`;
const tokenPath='/v1/identity/websocket-token';
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...safeHeaders,'Content-Type':'application/json; charset=utf-8'}});}
function trusted(request,url){const origin=request.headers.get('Origin');return (!origin||origin===url.origin)&&request.headers.get('Sec-Fetch-Site')!=='cross-site';}

// Only the game's own public database endpoints are reachable. No arbitrary URL,
// SQL API, management API, cookies, or hosting credentials are forwarded.
export async function route(request,env,fetchImpl=fetch){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/detective/config'&&request.method==='GET')return json({
    configured:false,model:'',csrf:'',hosting:'cloud',clientBuild:typeof __BUILD_ID__==='undefined'?'test':__BUILD_ID__,
    uri:url.origin,fallbackUri:upstream.origin,identityUri:upstream.origin,database,
  });
  if(path==='/api/detective/chat')return json({error:'云端对话服务尚未配置，你仍可继续探索和推理。',code:'gemini_key_missing'},503);
  if(path==='/api/connection-check'&&request.method==='GET'){
    if(!trusted(request,url))return json({error:'此来源不能进行连接检测。'},403);
    try{const response=await fetchImpl(new URL(identityPath,upstream),{signal:AbortSignal.timeout(8000),redirect:'manual'});return json({ok:response.ok,status:response.status,code:response.ok?'reachable':'http-error'});}
    catch{return json({ok:false,code:'network-error'});}
  }
  if([identityPath,subscribePath,tokenPath].includes(path)){
    if(!trusted(request,url))return json({error:'此来源不能访问联机入口。'},403);
    const socket=path===subscribePath;
    if(request.method!==(path===tokenPath?'POST':'GET'))return json({error:'请求方式不支持。'},405);
    if(socket&&request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要实时连接。'},426);
    if(Number(request.headers.get('Content-Length')||0)>0)return json({error:'此接口不接收消息内容。'},413);
    const target=new URL(path,upstream),headers=new Headers();
    if(socket){
      for(const [key,value] of url.searchParams){
        if(!['token','compression','light','confirmed'].includes(key)||value.length>8192)return json({error:'连接参数不正确。'},400);
        target.searchParams.set(key,value);
      }
      target.searchParams.set('compression','None');
      headers.set('Upgrade','websocket');
      const protocol=request.headers.get('Sec-WebSocket-Protocol');
      if(protocol)headers.set('Sec-WebSocket-Protocol',protocol);
    }else if(path===tokenPath){
      const auth=request.headers.get('Authorization')||'';
      if(!auth.startsWith('Bearer ')||auth.length>8192)return json({error:'玩家身份缺失。'},401);
      headers.set('Authorization',auth);
    }
    try{
      const response=await fetchImpl(target,{method:request.method,headers,redirect:'manual',...(!socket?{signal:AbortSignal.timeout(8000)}:{})});
      if(socket&&response.status===101)return response;
      if(response.status>=300&&response.status<400)return json({error:'对局服务暂时不可用。'},502);
      const returned=new Headers(safeHeaders);returned.set('Content-Type',response.headers.get('Content-Type')||'application/json');
      // Preserve an explicit rejection for SDK versions that inspect statusText.
      return new Response(response.body,{status:response.status,statusText:response.status===401?'Unauthorized':response.status===403?'Forbidden':response.statusText,headers:returned});
    }catch{return json({error:'对局服务暂时不可用，请稍后重试。'},502);}
  }
  if(path.startsWith('/api/')||path.startsWith('/v1/'))return json({error:'找不到这个入口。'},404);
  if(env.ASSETS)return env.ASSETS.fetch(request);
  return new Response('Not found',{status:404});
}
export default {fetch(request,env){return route(request,env);}};
