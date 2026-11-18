import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectVideo} from '../dist/video.js';
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function setup(t,options={}){
 t.mock.timers.enable({apis:['setTimeout']});let created=0,revoked=0;
 class Video extends EventTarget {
  constructor(){super();this.readyState=0;this.videoWidth=options.width??640;this.videoHeight=options.height??360;this.duration=options.duration??2;this.seeking=false;this.time=0;}
  load(){if(this.src)queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event('loadedmetadata'));});}
  pause(){} removeAttribute(){this.src='';}
  get currentTime(){return this.time;}
  set currentTime(value){if(options.seekError)throw new Error('Seek unavailable');this.time=value;if(value>1000&&options.probeDuration){this.duration=options.probeDuration;queueMicrotask(()=>this.dispatchEvent(new Event('durationchange')));}}
 }
 const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Video()}});
 t.mock.method(URL,'createObjectURL',()=>{created++;return 'blob:video-test';});t.mock.method(URL,'revokeObjectURL',()=>revoked++);
 t.after(()=>{documentDescriptor?Object.defineProperty(globalThis,'document',documentDescriptor):delete globalThis.document;assert.equal(created,revoked,'every video URL is released');});
 return new Blob(['synthetic-video'],{type:'video/mp4'});
}
test('a decoded timeline over 60 seconds is rejected',async t=>{const clip=setup(t,{duration:60.01});await assert.rejects(inspectVideo(clip),/60 seconds/);});
test('invalid decoded dimensions are rejected',async t=>{const clip=setup(t,{width:0});await assert.rejects(inspectVideo(clip),/cannot be read/);});
test('zero-length decoded timelines are rejected',async t=>{const clip=setup(t,{duration:0});await assert.rejects(inspectVideo(clip),/cannot be read/);});
test('an unknown duration times out instead of inventing a value',async t=>{
 const clip=setup(t,{duration:Infinity}),result=inspectVideo(clip);const rejected=assert.rejects(result,/too long/);await flush();t.mock.timers.tick(20000);await rejected;
});
test('a failed duration seek rejects cleanly without an unhandled probe promise',async t=>{const clip=setup(t,{duration:Infinity,seekError:true});await assert.rejects(inspectVideo(clip));await flush();});
