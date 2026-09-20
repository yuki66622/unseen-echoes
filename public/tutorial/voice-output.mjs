// Plays a reply once. Every async boundary checks cancellation; never opens a microphone.
export class VoiceOutput {
  constructor({getContext,getToken,isAllowed=()=>true,getVolume=()=>.35,silent=false,onState=()=>{}}){
    Object.assign(this,{getContext,getToken,isAllowed,getVolume,silent,onState});
    this.epoch=0;this.controller=null;this.source=null;this.gain=null;
  }
  cancel(){
    this.epoch++;this.controller?.abort();this.controller=null;
    if(this.source){this.source.onended=null;try{this.source.stop();}catch{}this.source.disconnect();}
    this.source=null;this.gain?.disconnect();this.gain=null;this.onState('idle');
  }
  setVolume(){if(this.gain)this.gain.gain.value=this.silent?0:this.getVolume();}
  async speak(text){
    this.cancel();
    if(!this.isAllowed()||!text)return false;
    const epoch=this.epoch,controller=new AbortController();this.controller=controller;
    const current=()=>this.epoch===epoch&&!controller.signal.aborted&&this.isAllowed();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},25000);
    this.onState('loading');
    try{
      const response=await fetch('/api/tutorial/speak',{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-Voice-Token':this.getToken()},
        body:JSON.stringify({text:text.slice(0,400)})});
      if(!response.ok){const error=await response.json();throw new Error(error.error?.message||'语音回复暂不可用。');}
      const bytes=await response.arrayBuffer();if(!current())return false;
      const context=this.getContext();if(!context||context.state!=='running')return false;
      const buffer=await context.decodeAudioData(bytes);if(!current())return false;
      const source=context.createBufferSource(),gain=context.createGain();
      gain.gain.value=this.silent?0:this.getVolume();
      source.buffer=buffer;source.connect(gain);gain.connect(context.destination);
      this.source=source;this.gain=gain;
      source.onended=()=>{if(this.source===source){source.disconnect();gain.disconnect();this.source=null;this.gain=null;this.onState('idle');}};
      source.start();this.onState(this.silent?'silent':'speaking',{duration:buffer.duration,outputGain:gain.gain.value});
      return true;
    }catch(error){if(this.epoch===epoch&&(!controller.signal.aborted||timedOut))this.onState('error',{message:timedOut?'语音回复超时，文字回复仍可使用。':error.message});return false;}
    finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
}
