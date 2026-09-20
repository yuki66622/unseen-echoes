const NUMBER = {'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,one:1,two:2,three:3,four:4,five:5,six:6};
const fail = reason => ({ok:false,reason});
const success = (command,label) => ({ok:true,command,label});

// Recognize an entire bounded instruction, never a keyword inside arbitrary speech.
export function parseVoiceCommand(input) {
  if(typeof input!=='string'||input.length>200)return fail('请一次只说一个简短动作。');
  let text=input.trim().toLowerCase().replace(/[。.!！?？,，;；\s]+$/u,'').replace(/\s+/g,' ');
  if(!text)return fail('没有听清指令，请再说一次。');
  if(/不|别|勿|还是|或者|\b(?:not|don't|dont|never|or)\b/.test(text))return fail('这句话有否定或选择，没有执行。请直接说一个动作。');
  text=text.replace(/^(?:请帮我|帮我|请|麻烦)(?:你)?\s*/u,'').replace(/^please\s+/,'');
  const chinese=text.replace(/\s+/g,'').replace(/(?:一下|吧)$/u,'');
  const simple={
    '开门':['door','open','开门'],'打开门':['door','open','开门'],'打开房门':['door','open','开门'],'把门打开':['door','open','开门'],
    '关门':['door','close','关门'],'关上门':['door','close','关门'],'关闭房门':['door','close','关门'],'把门关上':['door','close','关门'],
    '确认':['confirm',null,'确认声源'],'确认雨声':['confirm',null,'确认声源'],
    '确认这里是雨声':['confirm',null,'确认声源'],'这里是雨声':['confirm',null,'确认声源'],
    '我找到雨声了':['confirm',null,'确认声源'],'我找到了雨声':['confirm',null,'确认声源'],
    '暂停':['pause',null,'暂停声音'],'暂停声音':['pause',null,'暂停声音'],'停止':['pause',null,'暂停声音'],
  };
  const english={
    'open door':['door','open','开门'],'open the door':['door','open','开门'],
    'close door':['door','close','关门'],'close the door':['door','close','关门'],
    'confirm':['confirm',null,'确认声源'],'confirm rain':['confirm',null,'确认声源'],
    'this is rain':['confirm',null,'确认声源'],'pause':['pause',null,'暂停声音'],'stop':['pause',null,'暂停声音'],
  };
  const item=Object.hasOwn(simple,chinese)?simple[chinese]:Object.hasOwn(english,text)?english[text]:null;
  if(item)return success({type:item[0],...(item[1]?{state:item[1]}:{})},item[2]);
  // "A little" is a defined half-metre step, not an inferred distance.
  const little=chinese.match(/^(前进|后退|(?:往|向)[前后](?:再)?(?:走)?)(?:一?点(?:儿)?)$/u);
  if(little){
    const direction=/前/.test(little[1])?'forward':'back';
    return success({type:'move',direction,steps:1},`${direction==='forward'?'前进':'后退'} 1 步（半米）`);
  }
  let match=chinese.match(/^(前进|后退|(?:往|向)[前后](?:再)?走)([一二两三四五六\d]+)?(?:步)?$/u);
  if(!match)match=text.match(/^(?:(?:move|go) )?(forward|back|backward|backwards)(?: (one|two|three|four|five|six|\d+)(?: steps?)?)?$/);
  if(match){
    const steps=match[2]?(NUMBER[match[2]]??Number(match[2])):1;
    if(!Number.isInteger(steps)||steps<1||steps>6)return fail('每次可以移动 1 到 6 步，请分次说。');
    const direction=/前|forward/.test(match[1])?'forward':'back';
    return success({type:'move',direction,steps},`${direction==='forward'?'前进':'后退'} ${steps} 步`);
  }
  match=chinese.match(/^(左转|右转|向左转|向右转)(?:(三十|六十|九十|一百八十|\d+)度)?$/u);
  if(!match)match=text.match(/^(?:turn )?(left|right)(?: (30|60|90|180) degrees?)?$/);
  if(match){
    const degrees=match[2]?({'三十':30,'六十':60,'九十':90,'一百八十':180}[match[2]]??Number(match[2])):30;
    if(![30,60,90,180].includes(degrees))return fail('可以说左转或右转，角度支持 30、60、90、180 度。');
    const direction=/左|left/.test(match[1])?'left':'right';
    return success({type:'turn',direction,degrees},`${direction==='left'?'左转':'右转'} ${degrees} 度`);
  }
  return fail('未执行。可以说“前进两步”“左转”“开门”或“确认这里是雨声”，一次一个动作。');
}
