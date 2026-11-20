class OrbitalSpatialVoice extends AudioWorkletProcessor {
  constructor({processorOptions:{module,pose}}){
    super();
    this.dsp=new WebAssembly.Instance(module,{}).exports;
    this.dsp._initialize();
    this.pose=new Float32Array(this.dsp.memory.buffer,this.dsp.params(),40);
    this.channels=Array.from({length:4},(_,i)=>new Float32Array(this.dsp.memory.buffer,this.dsp.samples()+i*8192*4,8192));
    this.pose.set(pose);this.dsp.position(0);
    this.port.onmessage=({data})=>{
      if(data.stop){this.done=true;return}
      this.pose.set(data.pose);this.dsp.position(Math.max(128,Math.round((data.at-currentTime)*sampleRate)));
    };
  }
  process(inputs,outputs){
    if(this.done)return false;
    const input=inputs[0][0],dry=outputs[0],wet=outputs[1][0],n=wet.length;
    if(input)this.channels[0].set(input);else this.channels[0].fill(0,0,n);
    this.dsp.render(n);
    dry[0].set(this.channels[1].subarray(0,n));dry[1].set(this.channels[2].subarray(0,n));wet.set(this.channels[3].subarray(0,n));
    return true;
  }
}
registerProcessor('orbital-web-spatial',OrbitalSpatialVoice);
