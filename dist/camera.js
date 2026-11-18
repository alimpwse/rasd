export class Camera {
  constructor(video,onState) {this.video=video; this.onState=onState; this.generation=0; this.stream=null;}
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach(track=>track.stop());
    this.stream=null;
    this.video.srcObject=null;
  }
  async start() {
    this.stop();
    const generation=this.generation;
    if(!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      this.onState('error','Live preview needs HTTPS. Use the phone camera or choose a photo.');
      return;
    }
    this.onState('starting','Starting live preview…');
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}});
      if(generation !== this.generation || document.hidden) {stream.getTracks().forEach(track=>track.stop()); return;}
      this.stream=stream;
      this.video.srcObject=stream;
      await this.video.play();
      if(generation !== this.generation) return;
      this.onState('live','Live preview ready');
      for(const track of stream.getVideoTracks()) {
        track.onended=()=>{if(generation===this.generation) {this.stop(); this.onState('error','Preview stopped. Tap Restart preview.');}};
      }
    } catch(error) {
      if(generation !== this.generation) return;
      this.stop();
      const message=error.name==='NotAllowedError' ? 'Camera permission was denied. Enable it in site settings, or use the phone camera.' :
        error.name==='NotFoundError' ? 'No camera available. Choose a photo to continue.' : 'Preview unavailable. Retry or use the phone camera.';
      this.onState('error',message);
    }
  }
}
