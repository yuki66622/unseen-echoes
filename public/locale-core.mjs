import {getLanguage} from './locale-state.mjs';
import {entries as common,patterns as commonPatterns} from './locales/common.mjs';
import {entries as tutorial,patterns as tutorialPatterns} from './locales/tutorial.mjs';
import {entries as multiplayer,patterns as multiplayerPatterns} from './locales/multiplayer.mjs';
import {entries as hotel,patterns as hotelPatterns,reversePatterns as hotelReversePatterns} from './locales/hotel.mjs';
const english=new Map(),chinese=new Map();
for(const [zh,en] of [...hotel,...multiplayer,...tutorial,...common]){english.set(zh.trim(),en);chinese.set(en.trim(),zh);}
const patterns=[...commonPatterns,...tutorialPatterns,...multiplayerPatterns,...hotelPatterns];
export function translate(value,language=getLanguage()){
  const text=String(value??''),key=text.trim();if(!key)return text;
  const dictionary=language==='en'?english:chinese;
  let result=dictionary.get(key);
  if(result===undefined){
    for(const [pattern,replacement]of language==='en'?patterns:hotelReversePatterns){
      pattern.lastIndex=0;if(pattern.test(key)){pattern.lastIndex=0;result=key.replace(pattern,replacement);break;}
    }
  }
  return result===undefined?text:text.slice(0,text.indexOf(key))+result+text.slice(text.indexOf(key)+key.length);
}
