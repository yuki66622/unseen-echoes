import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{route} from '../src/worker.mjs';
import connection from '../connection.json' with {type:'json'};
const origin='https://game.example.invalid';
const subscription=`/v1/database/${connection.database}/subscribe`;

test('cloud config uses same-origin gateway and a same-database fallback without secrets',async()=>{
  const data=await (await route(new Request(`${origin}/api/detective/config`),{})).json();
  assert.equal(data.uri,origin);assert.equal(data.fallbackUri,connection.uri);
  assert.equal(data.identityUri,connection.uri);assert.equal(data.hosting,'cloud');
  assert.equal(data.configured,false);assert.equal(data.csrf,'');
});
test('public gateway never proxies arbitrary URLs or management APIs',async()=>{
  let called=false;const fetchImpl=()=>{called=true;throw Error();};
  for(const path of ['/v1/database/another-db/subscribe','/v1/database/test/sql','/api/proxy?url=https://other.invalid']){
    assert.equal((await route(new Request(origin+path),{},fetchImpl)).status,404);
  }
  assert.equal(called,false);
});
test('WebSocket upgrade is passed through without cookies or hosting headers',async()=>{
  const response={status:101,webSocket:{}};
  const request=new Request(origin+subscription+'?compression=Gzip&token=TEMP_TEST',{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':'v1.bsatn.spacetimedb',Cookie:'HOSTING_SECRET','OAI-Sites-Authorization':'HOSTING_SECRET'}});
  const result=await route(request,{},async(url,options)=>{
    assert.equal(url.origin,connection.uri);assert.equal(url.pathname,subscription);
    assert.equal(url.searchParams.get('compression'),'None');assert.equal(url.searchParams.get('token'),'TEMP_TEST');
    assert.equal(options.headers.get('Upgrade'),'websocket');
    assert.equal(options.headers.get('Cookie'),null);assert.equal(options.headers.get('OAI-Sites-Authorization'),null);
    return response;
  });assert.equal(result,response);
});
test('saved identity exchange preserves numeric 401 and SDK-readable rejection',async()=>{
  const response=await route(new Request(origin+'/v1/identity/websocket-token',{method:'POST',headers:{Authorization:'Bearer TEST_ONLY'}}),{},async(url,options)=>{
    assert.equal(url.origin,connection.uri);assert.equal(options.headers.get('Authorization'),'Bearer TEST_ONLY');
    return new Response('{}',{status:401});
  });
  assert.equal(response.status,401);assert.equal(response.statusText,'Unauthorized');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('cross-site requests and unsupported WebSocket query keys fail before egress',async()=>{
  const fetchImpl=()=>{throw Error('Should not be reached');};
  assert.equal((await route(new Request(origin+subscription,{headers:{Upgrade:'websocket',Origin:'https://other.invalid'}}),{},fetchImpl)).status,403);
  assert.equal((await route(new Request(origin+subscription+'?url=https://other.invalid',{headers:{Upgrade:'websocket'}}),{},fetchImpl)).status,400);
});
test('upstream errors are sanitized and never cached',async()=>{
  const response=await route(new Request(origin+'/api/connection-check'),{},async()=>{throw Error('SECRET_TEST_ONLY');});
  assert.deepEqual(await response.json(),{ok:false,code:'network-error'});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('static assets use the runtime binding, and Worker context is not mistaken for fetch',async t=>{
  const response=await worker.fetch(new Request(origin+'/'),{ASSETS:{fetch:async()=>new Response('page')}},{waitUntil(){}});
  assert.equal(await response.text(),'page');
  t.mock.method(globalThis,'fetch',async()=>new Response('{}'));
  const health=await worker.fetch(new Request(origin+'/api/connection-check'),{},{waitUntil(){}});
  assert.equal((await health.json()).ok,true);
});
