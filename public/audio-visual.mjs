// A meter has no destination connection and exposes no source identity or pose.
export function createVisualMeter(context){
 if(!context?.createAnalyser)return null;
 const analyser=context.createAnalyser();analyser.fftSize=1024;
 return {analyser,samples:new Float32Array(1024)};
}
export function readVisualMeter(meter,active){
 if(!meter||!active)return {active:false,rms:0,proximity:0};
 try{meter.analyser.getFloatTimeDomainData(meter.samples);let energy=0;for(const sample of meter.samples){if(!Number.isFinite(sample))return {active:false,rms:0,proximity:0};energy+=sample*sample;}const rms=Math.sqrt(energy/meter.samples.length);return {active:true,rms,proximity:Math.min(1,rms*8)};}catch{return {active:false,rms:0,proximity:0};}
}
