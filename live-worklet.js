class EasyTsCapture extends AudioWorkletProcessor {
  constructor(){super();this.samples=[];this.phase=0;this.sum=0;this.count=0;}
  process(inputs){
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let value=0;for(const c of channels)value+=c[i]/channels.length;
      this.sum+=value;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;this.samples.push(Math.round(Math.max(-1,Math.min(1,this.sum/this.count))*32767));this.sum=0;this.count=0;}
      if(this.samples.length===2048){const data=new Int16Array(this.samples);this.port.postMessage(data.buffer,[data.buffer]);this.samples=[];}
    }
    return true;
  }
}
registerProcessor('easy-ts-capture',EasyTsCapture);
