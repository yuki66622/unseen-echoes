// Reset the legacy automatic Chinese default once; explicit new choices persist.
const KEY='unseen-language-v2';
const valid=value=>value==='en'||value==='zh';
function initial(){
  try{const value=new URLSearchParams(globalThis.location?.search||'').get('lang');if(valid(value))return value;}catch{}
  try{const value=globalThis.localStorage?.getItem(KEY);if(valid(value))return value;}catch{}
  return 'en';
}
let language=initial();
export const getLanguage=()=>language;
export function setLanguage(value,{persist=true}={}){
  if(!valid(value))return;
  const changed=language!==value;language=value;
  if(persist)try{globalThis.localStorage?.setItem(KEY,value);}catch{}
  if(globalThis.document){document.documentElement.lang=value==='en'?'en':'zh-CN';document.documentElement.dataset.language=value;}
  if(changed&&globalThis.dispatchEvent)globalThis.dispatchEvent(new CustomEvent('unseen-language-change',{detail:{language:value}}));
}
setLanguage(language);
if(globalThis.addEventListener)globalThis.addEventListener('storage',event=>{if(event.key===KEY&&valid(event.newValue))setLanguage(event.newValue,{persist:false});});
