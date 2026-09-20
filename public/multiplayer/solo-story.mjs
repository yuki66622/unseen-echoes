import {LOCATIONS, distance, hasLineOfSight} from '../room-layout.mjs';

// A local, original case. These facts are mirrored in detective_service.py;
// only discovered facts, never the solution or this whole module, go to Gemini.
const CLUES = Object.freeze({
  a: Object.freeze({id:'a', title:'庭院录音', text:'庭院录音记录了 18:00 正常响起的钟声。18:10，值班员发现钟绳已被割断，钟声停止。录音和这两个时间均已核实。'}),
  b: Object.freeze({id:'b', title:'钟室勘查', text:'钟绳被人用刀刃蓄意割断，现场没有强行闯入的痕迹。检修口在 17:55 贴上的封条完好无损，窗户从室内上了闩。正门是进入钟室的唯一通道。'}),
  c: Object.freeze({id:'c', title:'门禁记录', text:'经核实，门禁记录完整记载了每一次进出：维修员，17:40–17:50；门卫，18:02–18:08；馆长，18:15–18:20。三人均独自进入，除此之外无人进入，各次来访之间也没有人留在室内。'}),
});

export const STORY_INTRO = '《沉默的钟声》。博物馆的闭馆钟遭到破坏。门卫、维修员和馆长这三名工作人员中，有一人割断了钟绳。循着鸟鸣、雨声和火声，调查三处证据。记录真实可信，请判断谁的来访时间符合证据。这是你独自完成的调查。';

export const STORY_SOURCES = Object.freeze(LOCATIONS.map((location, index) =>
  Object.freeze({...location, soundId:['forest','rain','fire'][index]})));

export function createStory() {
  return {discovered:[], outcome:null, attempts:0, lastAccusation:null};
}

function discoveredClues(state) {
  const ids = new Set(Array.isArray(state?.discovered) ? state.discovered : []);
  return Object.values(CLUES).filter(clue => ids.has(clue.id));
}

export function inspectStory(state, pose, doorOpen = false) {
  if (state?.outcome) return {ok:false, message:'案件已经结案。'};
  if (!state || !Array.isArray(state.discovered) || !pose ||
      !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
    return {ok:false, message:'暂时无法确定你的位置，请移动后重试。'};
  }
  const source = STORY_SOURCES.find(item => distance(pose, item) <= 1.1 &&
    hasLineOfSight(pose, item, doorOpen === true));
  if (!source) return {ok:false, message:'请靠近声音后再调查。你无法隔着墙壁或关闭的门检查证据。'};
  const clue = CLUES[source.id];
  if (state.discovered.includes(source.id)) {
    return {ok:false, message:`你的笔记中已有这条线索：${clue.title}。`};
  }
  state.discovered.push(source.id);
  return {ok:true, message:`${clue.title}：${clue.text}`};
}

export function storyView(state) {
  const clues = discoveredClues(state).map(clue => ({...clue}));
  return {
    objective:state?.outcome ? '案件已结案，你的调查完成了。' :
      clues.length < 3 ? `调查三处声音来源。已收集证据：${clues.length}/3。` :
      '对照作案时间范围、可能的入口和来访记录，判断是谁割断了钟绳。',
    clues,
    outcome:state?.outcome ?? null,
  };
}

export function accuseStory(state, suspect) {
  if (!state || !Array.isArray(state.discovered)) return {ok:false, message:'调查尚未开始。'};
  if (state.outcome) return {ok:false, message:'案件已经结案。'};
  if (!['porter','mechanic','curator'].includes(suspect)) {
    return {ok:false, message:'请选择门卫、维修员或馆长。'};
  }
  if (discoveredClues(state).length !== 3) {
    return {ok:false, message:'请先调查全部三处证据，再作出指认。'};
  }
  state.attempts += 1;
  state.lastAccusation = suspect;
  if (suspect !== 'porter') {
    return {ok:false, message:'这一指认与完整记录不符。请对照最后一次正常钟声和首次发现钟绳被割断的时间，再查看这段时间内谁进入过钟室。你可以重新判断。'};
  }
  state.outcome = 'solved';
  return {ok:true, message:'案件已结案。钟绳是在 18:00 至 18:10 之间被割断的。检修口封条完好、窗户上闩，说明只能从正门进入；这段时间里，只有门卫进入过钟室。你的证据指向了门卫。'};
}
