// Compatible with browsers that support AbortController but not AbortSignal.timeout.
export async function fetchWithTimeout(url,options={},timeout=8000,consume=response=>response){
  const controller=new AbortController(),upstream=options.signal;
  const cancel=()=>controller.abort();
  if(upstream?.aborted)cancel();else upstream?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,timeout);
  try{return await consume(await fetch(url,{...options,signal:controller.signal}));}
  finally{clearTimeout(timer);upstream?.removeEventListener('abort',cancel);}
}
