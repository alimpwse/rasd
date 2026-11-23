export class Camera {
  constructor(video,onState) {
    this.video=video;this.onState=onState;this.generation=0;this.stream=null;
    this.starting=false;this.live=false;this.permissionDenied=false;
  }
  stop() {
    this.generation++;
    this.starting=false;this.live=false;
    this.stream?.getTracks().forEach(track=>track.stop());
    this.stream=null;
    this.video.srcObject=null;
  }
  async start({retry=false}={}) {
    if(this.starting || this.live || (this.permissionDenied && !retry))return;
    const generation=++this.generation;
    if(!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      this.onState('error','Live preview is unavailable here. Open RASD in Safari or use the phone camera.');
      return;
    }
    this.starting=true;
    this.onState('starting','Starting live preview…');
    let stream=this.stream;
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}});
      if(generation!==this.generation || document.hidden){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;
      this.permissionDenied=false;
      if(this.video.srcObject!==stream)this.video.srcObject=stream;
      for(const track of stream.getVideoTracks()){
        track.onended=()=>{if(generation===this.generation){this.stop();this.onState('error','Preview stopped. Tap Restart preview.');}};
      }
      await this.video.play();
      if(generation!==this.generation)return;
      this.live=true;
      this.onState('live','Live preview ready');
    }catch(error){
      if(generation!==this.generation)return;
      if(stream && this.stream===stream){
        this.onState('playback','Camera is connected. Tap Start preview to play it.');
        return;
      }
      this.stop();
      this.permissionDenied=error.name==='NotAllowedError' || error.name==='SecurityError';
      const message=this.permissionDenied?'Camera permission was denied. In Safari, open Website Settings and set Camera to Allow. The shutter still works.':
        error.name==='NotFoundError'?'No camera available. Choose a photo to continue.':'Preview unavailable. Retry or use the phone camera.';
      this.onState(this.permissionDenied?'denied':'error',message);
    }finally{if(generation===this.generation)this.starting=false;}
  }
}
