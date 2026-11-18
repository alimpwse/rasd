import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/video-capture.js');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup(t,options={}) {
  assert.equal(typeof module.HoldVideoCapture,'function','hold-to-record controller is available');
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  class Track extends EventTarget {constructor(kind){super();this.kind=kind;this.readyState='live';this.stops=0;}clone(){this.cloneTrack=new Track(this.kind);return this.cloneTrack;}stop(){this.stops++;this.readyState='ended';}}
  class Stream {constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
  const preview=new Track('video'),mic=new Track('audio'),permission=deferred(),recorders=[],errors=[],states=[],videos=[];
  class Recorder extends EventTarget {
    static isTypeSupported(type){return options.webmOnly ? type.startsWith('video/webm') : type.startsWith('video/mp4')||type.startsWith('video/webm');}
    constructor(stream,config){super();this.stream=stream;this.mimeType=config?.mimeType||'video/webm';this.state='inactive';recorders.push(this);}
    start(){if(options.startError)throw new Error('Recorder unavailable');this.state='recording';}
    emit(data){const event=new Event('dataavailable');event.data=data;this.dispatchEvent(event);}
    stop(){if(this.state==='inactive')return;this.state='inactive';queueMicrotask(()=>{this.emit(new Blob(['clip'],{type:this.mimeType}));this.dispatchEvent(new Event('stop'));});}
  }
  const globals={MediaRecorder:Recorder,MediaStream:Stream,navigator:{mediaDevices:{getUserMedia:()=>permission.promise}},window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false})};
  const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const button=Object.assign(new EventTarget(),{setPointerCapture(){},releasePointerCapture(){},hasPointerCapture(){return false;}});
  let photos=0;
  const capture=new module.HoldVideoCapture(button,{getStream:()=>new Stream([preview]),canStart:()=>options.canStart!==false,onPhoto:()=>photos++,onVideo:async blob=>{videos.push(blob);await options.deliver?.promise;},onState:s=>states.push(s),onError:error=>errors.push(error)});
  const fire=(type,target=button,props={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,button:0,isPrimary:true,...props});target.dispatchEvent(event);return event;};
  t.after(()=>{capture.destroy();for(const [key,descriptor]of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  return {capture,fire,permission,preview,mic,recorders,errors,states,videos,photos:()=>photos,grant:async()=>{permission.resolve(new Stream([mic]));await flush();},hold:async()=>{fire('pointerdown');t.mock.timers.tick(400);await flush();}};
}

test('a short tap calls the native photo action synchronously from click',t=>{
  const f=setup(t);f.fire('pointerdown');t.mock.timers.tick(399);f.fire('pointerup');
  assert.equal(f.photos(),0);f.fire('click');assert.equal(f.photos(),1);assert.equal(f.capture.active,false);assert.equal(f.recorders.length,0);
});
test('release while microphone permission is pending cannot start a late recording',async t=>{
  const f=setup(t);await f.hold();assert.equal(f.capture.active,true);assert.equal(f.states.at(-1).status,'requesting');
  f.fire('pointerup');f.fire('click');await f.grant();assert.equal(f.recorders.length,0);assert.equal(f.photos(),0);assert.equal(f.mic.stops,1);assert.equal(f.preview.stops,0);assert.equal(f.preview.cloneTrack.stops,1);assert.equal(f.capture.active,false);
});
test('long hold records cloned preview plus audio, prefers MP4 and awaits delivery',async t=>{
  const deliver=deferred(),f=setup(t,{deliver});await f.hold();await f.grant();
  assert.equal(f.states.at(-1).status,'recording');assert.match(f.recorders[0].mimeType,/^video\/mp4/);assert.equal(f.recorders[0].stream.getTracks().length,2);
  t.mock.timers.tick(1200);f.fire('pointerup');f.fire('click');await flush();assert.equal(f.photos(),0);assert.equal(f.videos.length,1);assert.equal(f.capture.active,true);assert.equal(f.states.at(-1).status,'finishing');assert.equal(f.preview.stops,0);assert.equal(f.mic.stops,1);assert.equal(f.preview.cloneTrack.stops,1);
  deliver.resolve();await flush();assert.equal(f.capture.active,false);assert.equal(f.states.at(-1).status,'idle');
});
test('cancel discards recorder output and destroy removes the photo handler',async t=>{
  const f=setup(t);await f.hold();await f.grant();f.capture.cancel();await flush();assert.equal(f.videos.length,0);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);assert.equal(f.preview.stops,0);f.capture.destroy();f.fire('click');assert.equal(f.photos(),0);
});
test('unsupported MP4 falls back to WebM and recording ends at the time cap',async t=>{
  const f=setup(t,{webmOnly:true});await f.hold();await f.grant();assert.match(f.recorders[0].mimeType,/^video\/webm/);t.mock.timers.tick(60000);await flush();assert.equal(f.recorders[0].state,'inactive');assert.equal(f.videos.length,1);assert.equal(f.capture.active,false);assert.ok(f.states.filter(s=>s.status==='recording').every(s=>s.elapsed<=60));
});
test('an oversized recording is rejected without delivering a truncated clip',async t=>{
  const f=setup(t);await f.hold();await f.grant();f.recorders[0].emit(new Blob([new Uint8Array(50*1024*1024+1)],{type:'video/mp4'}));await flush();assert.equal(f.videos.length,0);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/50/);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);
});
test('recorder startup failure cleans owned tracks and leaves preview intact',async t=>{
  const f=setup(t,{startError:true});await f.hold();await f.grant();assert.equal(f.errors.length,1);assert.equal(f.videos.length,0);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);assert.equal(f.preview.cloneTrack.stops,1);assert.equal(f.preview.stops,0);
});
test('page interruption finishes recording and leaves the preview track intact',async t=>{
  const f=setup(t);await f.hold();await f.grant();f.fire('pagehide',window);await flush();assert.equal(f.videos.length,1);assert.equal(f.capture.active,false);assert.equal(f.preview.stops,0);
});
test('a cancelled pointer cannot launch a photo or record after the hold delay',async t=>{
  const f=setup(t);f.fire('pointerdown');f.fire('pointercancel');t.mock.timers.tick(1000);f.fire('click');await flush();assert.equal(f.photos(),0);assert.equal(f.recorders.length,0);assert.equal(f.capture.active,false);
});
test('cancelling the held pointer discards an active recording and releases owned tracks',async t=>{
  const f=setup(t);await f.hold();await f.grant();f.fire('pointercancel');await flush();f.fire('click');
  assert.equal(f.videos.length,0);assert.equal(f.photos(),0);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);assert.equal(f.preview.cloneTrack.stops,1);assert.equal(f.preview.stops,0);
});
test('cancelling another pointer cannot interrupt the held shutter',async t=>{
  const f=setup(t);await f.hold();await f.grant();f.fire('pointercancel',window,{pointerId:2});await flush();
  assert.equal(f.recorders[0].state,'recording');assert.equal(f.capture.active,true);assert.equal(f.videos.length,0);
  f.fire('pointerup');await flush();assert.equal(f.videos.length,1);assert.equal(f.capture.active,false);
});
test('failed delivery releases each owned track once and reports the failure',async t=>{
  const deliver=deferred(),f=setup(t,{deliver});await f.hold();await f.grant();f.capture.stop();await flush();deliver.reject(new Error('Decode failed'));await flush();assert.equal(f.errors.length,1);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);assert.equal(f.preview.cloneTrack.stops,1);
});
test('a preview ended while microphone permission was pending cannot start recording',async t=>{
  const f=setup(t);await f.hold();f.preview.readyState='ended';f.preview.dispatchEvent(new Event('ended'));await f.grant();assert.equal(f.recorders.length,0);assert.equal(f.capture.active,false);assert.equal(f.mic.stops,1);
});
test('microphone denial reports the error and removes the cloned video track',async t=>{
  const f=setup(t);await f.hold();f.permission.reject(new DOMException('Permission denied','NotAllowedError'));await flush();assert.equal(f.errors.length,1);assert.equal(f.capture.active,false);assert.equal(f.preview.cloneTrack.stops,1);assert.equal(f.preview.stops,0);
});
test('explicit cancel during the initial hold suppresses the following photo click',async t=>{
 const f=setup(t);f.fire('pointerdown');t.mock.timers.tick(100);f.capture.cancel();f.fire('pointerup');f.fire('click');t.mock.timers.tick(400);await flush();assert.equal(f.photos(),0);assert.equal(f.recorders.length,0);
});
