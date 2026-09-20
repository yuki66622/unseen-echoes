import {getLanguage,setLanguage} from './locale-state.mjs';
import {translate} from './locale-core.mjs';
export {translate,getLanguage,setLanguage};

// Only authored presentation is translated. Input values and marked player/model
// text remain untouched; changing language never reloads or touches game state.
const textMemory=new WeakMap(),attributeMemory=new WeakMap();
const attributes=['placeholder','aria-label','title'];
const excluded='script,style,code,pre,textarea,output,[data-no-localize],#qa-state,#debug,#connection-check-copy,#profile-name,#active-code';
function eligible(node){return node?.parentElement&&!node.parentElement.closest(excluded);}
function applyText(node){
  if(!eligible(node)||!node.data.trim())return;
  const previous=textMemory.get(node),current=node.data;
  const source=previous&&current===previous.output?previous.source:current;
  const output=translate(source);textMemory.set(node,{source,output});if(current!==output)node.data=output;
}
function applyAttributes(element){
  if(element.closest('script,style,[data-no-localize]'))return;
  let memory=attributeMemory.get(element);if(!memory){memory={};attributeMemory.set(element,memory);}
  for(const name of attributes){
    const current=element.getAttribute(name);if(current===null)continue;
    const previous=memory[name],source=previous&&current===previous.output?previous.source:current;
    const output=translate(source);memory[name]={source,output};if(current!==output)element.setAttribute(name,output);
  }
}
function applyTree(root){
  if(root.nodeType===Node.TEXT_NODE){applyText(root);return;}
  if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE)return;
  if(root.nodeType===Node.ELEMENT_NODE){applyAttributes(root);if(root.matches(excluded))return;}
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const n=walker.currentNode;if(n.nodeType===Node.TEXT_NODE)applyText(n);else applyAttributes(n);}
}
let switcher;
function sync(){
  applyTree(document.documentElement);
  if(switcher){switcher.setAttribute('aria-label',getLanguage()==='en'?'Language':'语言');for(const button of switcher.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.language===getLanguage()));}
  document.documentElement.dataset.localeReady='true';
}
if(window.top===window){
  switcher=document.createElement('nav');switcher.id='language-switch';switcher.dataset.noLocalize='';
  switcher.innerHTML='<button type="button" data-language="zh" lang="zh-CN" aria-label="切换为中文">中文</button><button type="button" data-language="en" lang="en" aria-label="Switch to English">EN</button>';
  switcher.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;setLanguage(button.dataset.language);const url=new URL(location.href);url.searchParams.set('lang',getLanguage());history.replaceState(history.state,'',url);sync();});
  document.body.append(switcher);
}
const observer=new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='characterData')applyText(record.target);
    else if(record.type==='attributes')applyAttributes(record.target);
    else for(const node of record.addedNodes)applyTree(node);
  }
});
observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
addEventListener('unseen-language-change',sync);sync();
