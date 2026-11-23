import {MAX_VIDEO_BYTES,MAX_VIDEO_SECONDS} from './model.js';

const MIME_TYPES=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
const stopTracks=stream=>stream?.getTracks().forEach(track=>track.stop());

export class HoldVideoCapture {
  constructor(button,{getStream,canStart=()=>true,onPhoto,onVideo,onNativeVideo,onState=()=>{},onError=()=>{}}) {
    Object.assign(this,{button,getStream,canStart,onPhoto,onVideo,onNativeVideo,onState,onError});
    this.status='idle';this.held=false;this.suppressClick=false;this.generation=0;this.listeners=[];this.session=null;this.destroyed=false;
    this.listen(button,'pointerdown',event=>{
      if(event.button!==0 || event.isPrimary===false || this.active || !this.canStart())return;
      this.held=true;this.pointer=event.pointerId;this.suppressClick=false;this.nativePending=false;
      try{button.setPointerCapture(event.pointerId);}catch{}
      this.holdTimer=setTimeout(()=>{this.holdTimer=null;if(this.held){this.suppressClick=true;void this.begin();}},400);
    });
    const release=event=>{
      if(!this.held || event.pointerId!==this.pointer)return;
      if(this.status==='native'){
        this.releaseHold();
        this.state('idle');
        // Launch from the release gesture, or the following click if it grants activation.
        if(navigator.userActivation?.isActive!==false && this.canStart())this.onNativeVideo();
        else this.nativePending=true;
      }else this.stop();
    };
    const cancelled=event=>{if(this.held && event.pointerId===this.pointer)this.cancel();};
    const interrupted=()=>{if(this.active){this.suppressClick=true;this.stop();}};
    this.listen(button,'pointerup',release);this.listen(window,'pointerup',release);
    this.listen(button,'pointercancel',cancelled);this.listen(window,'pointercancel',cancelled);
    this.listen(button,'lostpointercapture',interrupted);
    this.listen(button,'contextmenu',event=>{if(this.held||this.suppressClick)event.preventDefault();});
    this.listen(button,'click',event=>{
      if(this.nativePending){
        this.nativePending=false;this.suppressClick=false;
        event.preventDefault();event.stopImmediatePropagation();
        if(this.canStart())this.onNativeVideo();
        return;
      }
      if(this.suppressClick||this.active){event.preventDefault();event.stopImmediatePropagation();this.suppressClick=false;return;}
      if(this.canStart())this.onPhoto();
    });
    this.listen(window,'blur',interrupted);this.listen(window,'pagehide',interrupted);
    this.listen(document,'visibilitychange',()=>{if(document.hidden)interrupted();});
  }
  get active(){return this.held||this.status!=='idle';}
  listen(target,event,handler){target.addEventListener(event,handler);this.listeners.push(()=>target.removeEventListener(event,handler));}
  state(status,elapsed=0){this.status=status;this.onState({status,elapsed});}
  elapsed(){return this.session?.started===undefined?0:Math.min(MAX_VIDEO_SECONDS,Math.max(0,(Date.now()-this.session.started)/1000));}
  releaseHold(){clearTimeout(this.holdTimer);this.holdTimer=null;this.held=false;}
  cleanup(session){
    if(!session)return;
    clearInterval(session.ticker);clearTimeout(session.limit);clearTimeout(session.stopTimeout);
    session.off?.forEach(remove=>remove());session.off=[];
    if(session.stream){stopTracks(session.stream);session.stream=null;session.video=null;}
    else if(session.video){session.video.stop();session.video=null;}
  }
  async begin(){
    const mimeType=typeof MediaRecorder==='function' && typeof MediaRecorder.isTypeSupported==='function' && MIME_TYPES.find(type=>MediaRecorder.isTypeSupported(type));
    const source=this.getStream()?.getVideoTracks().find(track=>track.readyState==='live');
    if((!mimeType || !navigator.mediaDevices?.getUserMedia || !source) && this.onNativeVideo){
      this.state('native');
      return;
    }
    const generation=++this.generation,session={generation,chunks:[],bytes:0,off:[]};this.session=session;this.state('requesting');
    const listen=(target,event,handler)=>{target.addEventListener(event,handler);session.off.push(()=>target.removeEventListener(event,handler));};
    try {
      if(!mimeType || !navigator.mediaDevices?.getUserMedia)throw new Error('Hold to record is unavailable. Use Record video instead.');
      if(!source)throw new Error('Start the live camera preview first, or use Record video.');
      session.video=source.clone();
      for(const track of [source,session.video])listen(track,'ended',()=>this.stop());
      const microphone=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(generation!==this.generation || !this.held || this.destroyed){stopTracks(microphone);return;}
      if(source.readyState!=='live'||session.video.readyState!=='live'||document.hidden){stopTracks(microphone);throw new Error('The camera preview stopped. Please try again.');}
      const audio=microphone.getAudioTracks();
      if(!audio.length){stopTracks(microphone);throw new Error('A microphone is required. Use Record video instead.');}
      session.stream=new MediaStream([session.video,...audio]);
      for(const track of microphone.getTracks())if(!audio.includes(track))track.stop();
      const recorder=new MediaRecorder(session.stream,{mimeType});session.recorder=recorder;
      listen(recorder,'dataavailable',event=>{
        if(generation!==this.generation || !event.data?.size)return;
        session.bytes+=event.data.size;
        if(session.bytes>MAX_VIDEO_BYTES){this.fail(new Error('This recording exceeds 50 MB. Record a shorter clip.'),session);return;}
        session.chunks.push(event.data);
        if(session.bytes===MAX_VIDEO_BYTES)this.stop();
      });
      listen(recorder,'error',()=>this.fail(new Error('Recording failed. Try again or use Record video.'),session));
      listen(recorder,'stop',()=>{void this.finish(session);});
      for(const track of audio)listen(track,'ended',()=>this.stop());
      recorder.start(250);session.started=Date.now();this.state('recording');
      session.ticker=setInterval(()=>{if(this.session===session&&this.status==='recording')this.state('recording',this.elapsed());},100);
      // Leave a small muxing margin so an automatically stopped clip remains below 60 s.
      session.limit=setTimeout(()=>this.stop(),MAX_VIDEO_SECONDS*1000-250);
    }catch(error){if(generation===this.generation)this.fail(error,session);}
  }
  stop(){
    this.releaseHold();
    if(this.status==='requesting' || this.status==='native'){this.cancel();return;}
    if(this.status!=='recording')return;
    const session=this.session;this.state('finishing',this.elapsed());clearInterval(session.ticker);clearTimeout(session.limit);
    session.stopTimeout=setTimeout(()=>this.fail(new Error('The recording could not finish. Please try again.'),session),10000);
    try{if(session.recorder.state!=='inactive')session.recorder.stop();else void this.finish(session);}catch(error){this.fail(error,session);}
  }
  async finish(session){
    if(session.generation!==this.generation || session.finishing)return;
    session.finishing=true;this.releaseHold();this.state('finishing',this.elapsed());this.cleanup(session);
    try{
      const blob=new Blob(session.chunks,{type:session.recorder.mimeType||session.chunks[0]?.type});session.chunks=[];
      if(!blob.size)throw new Error('The recording is empty. Please try again.');
      if(blob.size>MAX_VIDEO_BYTES)throw new Error('This recording exceeds 50 MB. Record a shorter clip.');
      await this.onVideo(blob);
      if(session.generation===this.generation){this.session=null;this.state('idle');}
    }catch(error){if(session.generation===this.generation)this.fail(error,session);}
  }
  fail(error,session){if(session.generation!==this.generation)return;this.cancel();this.onError(error instanceof Error?error:new Error('Recording failed. Please try again.'));}
  cancel(){
    this.nativePending=false;
    if(this.active)this.suppressClick=true;
    this.generation++;this.releaseHold();const session=this.session;this.session=null;
    this.cleanup(session);
    if(session?.recorder?.state!=='inactive')try{session?.recorder?.stop();}catch{}
    if(session)session.chunks=[];
    if(this.status!=='idle')this.state('idle');
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel();this.listeners.splice(0).forEach(remove=>remove());}
}
