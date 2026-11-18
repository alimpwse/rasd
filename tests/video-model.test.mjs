import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../dist/model.js';
import {encodeFullBackup,decodeFullBackup} from '../dist/backup.js';
import {Preferences} from '../dist/preferences.js';

const photo=(id='photo')=>({id,original:new Blob(['photo bytes'],{type:'image/jpeg'}),thumbnail:new Blob(['still'],{type:'image/png'}),annotations:[],crop:{ratio:'16:9'}});
const video=(id='video',type='video/mp4')=>({id,kind:'video',original:new Blob([new Uint8Array([0,255,128,1,33])],{type}),thumbnail:new Blob(['still'],{type:'image/jpeg'}),duration:12.5,width:1920,height:1080,annotations:[],crop:{ratio:'original'}});
const note=(photos=[video()])=>({id:'note-1',createdAt:'2026-11-18T09:00:00Z',project:'',description:'ملاحظة فيديو',address:{area:'',block:'',street:''},location:null,photos});
const state=()=>({preferences:new Preferences({getItem:()=>null}).snapshot(),categories:{entries:[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'}],defaultId:''},projects:{names:[],active:''}});

test('video identification and extensions preserve supported original media types',()=>{
 assert.equal(typeof model.isVideo,'function');assert.equal(typeof model.mediaExtension,'function');
 assert.equal(model.isVideo(video()),true);assert.equal(model.isVideo({kind:'video'}),true);
 assert.equal(model.isVideo({original:new Blob(['x'],{type:'video/webm;codecs=vp8,opus'})}),true);
 assert.equal(model.isVideo(photo()),false);assert.equal(model.isVideo(null),false);
 for(const [type,want] of [['video/mp4','mp4'],['video/quicktime','mov'],['video/webm;codecs=vp8,opus','webm'],['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/heic','heic'],['image/heif','heif'],['application/octet-stream','bin'],['constructor','bin'],['__proto__','bin']]) {
  assert.equal(model.mediaExtension(new Blob(['x'],{type})),want);
 }
});

test('video-only notes retain original bytes, image poster and canonical metadata',()=>{
 const source=video(),record=note([source]),clean=model.validateRecord(record);
 assert.deepEqual(clean.photos,[source]);assert.equal(clean.original,source.original);assert.equal(clean.thumbnail,source.thumbnail);
 assert.deepEqual(model.photosOf(clean),clean.photos);assert.deepEqual(clean.annotations,[]);assert.deepEqual(clean.crop,{ratio:'original'});
 const inferred=video();delete inferred.kind;delete inferred.crop;
 assert.deepEqual(model.validateRecord(note([inferred])).photos[0],{...inferred,kind:'video',crop:{ratio:'original'}});
});

test('mixed notes retain attachment order and photo markup without adding video fields to photos',()=>{
 const first=photo(),last=photo('last');first.annotations=[{type:'text',x:.2,y:.3,text:'فحص',color:'#ffffff'}];
 const record=note([first,video(),last]),clean=model.validateRecord(record);
 assert.deepEqual(clean.photos,record.photos);assert.equal(clean.original,first.original);
 assert.deepEqual(Object.keys(clean.photos[0]).sort(),['annotations','crop','id','original','thumbnail']);
 assert.deepEqual(clean.photos[0].annotations,first.annotations);
});

test('supported video containers and recorder MIME parameters survive validation',()=>{
 for(const type of ['video/mp4','video/quicktime','video/webm','video/mp4;codecs=avc1.42e01e,mp4a.40.2','video/webm;codecs=vp8,opus']) {
  const clean=model.validateRecord(note([video('clip',type)]));assert.equal(clean.photos[0].original.type,type);
 }
});

test('videos reject invalid metadata, non-video originals, invalid posters and photo edits',()=>{
 const cases=[
  x=>x.duration=0,x=>x.duration=-1,x=>x.duration=60.01,x=>x.duration=Infinity,x=>x.duration=NaN,x=>x.duration='10',x=>delete x.duration,
  x=>x.width=0,x=>x.height=-1,x=>x.width=1.5,x=>x.height=NaN,x=>x.width=Infinity,x=>x.height='1080',x=>delete x.width,
  x=>{x.width=10000;x.height=8001;},x=>{x.width=32768;x.height=1;},x=>{x.width=1;x.height=32768;},
  x=>x.original=new Blob([],{type:'video/mp4'}),x=>x.original=new Blob(['x'],{type:'audio/mp4'}),x=>x.original=new Blob(['x'],{type:'video/avi'}),x=>x.original=new Blob(['x'],{type:'image/jpeg'}),
  x=>x.thumbnail=new Blob(['x'],{type:'video/mp4'}),x=>x.thumbnail=new Blob([],{type:'image/jpeg'}),x=>x.thumbnail=new Blob([new Uint8Array(512*1024+1)],{type:'image/jpeg'}),
  x=>x.annotations=[{type:'text',x:.2,y:.3,text:'no video markup',color:'#ffffff'}],x=>delete x.annotations,x=>x.crop={ratio:'16:9'},x=>x.crop=null
 ];
 for(const mutate of cases){const clip=video();mutate(clip);assert.throws(()=>model.validateRecord(note([clip])),undefined,String(mutate));}
 const boundary=video();boundary.duration=60;boundary.width=10000;boundary.height=8000;
 assert.equal(model.validateRecord(note([boundary])).photos[0].duration,60);
});

test('video byte limits coexist with the attachment count and combined original-byte limit',()=>{
 const large=new Blob([new Uint8Array(50*1024*1024)],{type:'video/mp4'}),first={...video('one'),original:large},second={...video('two'),original:large};
 assert.equal(model.validateRecord(note([first,second])).photos.length,2);
 assert.throws(()=>model.validateRecord(note([{...first,original:new Blob([large,'x'],{type:large.type})}])));
 assert.throws(()=>model.validateRecord(note([first,second,photo()])));
 assert.equal(model.validateRecord(note(Array.from({length:10},(_,i)=>video(`v${i}`)))).photos.length,10);
 assert.throws(()=>model.validateRecord(note(Array.from({length:11},(_,i)=>video(`v${i}`)))));
 assert.throws(()=>model.validateRecord(note([video(),video()])));
 assert.throws(()=>model.validateRecord(note([{...photo(),original:large,kind:'video',duration:10,width:1,height:1,crop:{ratio:'16:9'}}])));
});

test('video and mixed note backups use v4 and round-trip every original and poster byte',async()=>{
 for(const sources of [[video()],[photo(),video('webm','video/webm;codecs=vp8,opus'),video('mov','video/quicktime')]]) {
  const json=await model.encodeBackup([note(sources)]),wire=JSON.parse(json),[restored]=await model.decodeBackup(json);
  assert.equal(wire.version,4);assert.equal(wire.kind,'notes');assert.equal(Object.hasOwn(wire.records[0],'original'),false);
  assert.deepEqual(restored.photos.map(x=>x.id),sources.map(x=>x.id));
  for(let i=0;i<sources.length;i++) {
   const actual=restored.photos[i],expected=sources[i];
   assert.deepEqual(new Uint8Array(await actual.original.arrayBuffer()),new Uint8Array(await expected.original.arrayBuffer()));
   assert.deepEqual(new Uint8Array(await actual.thumbnail.arrayBuffer()),new Uint8Array(await expected.thumbnail.arrayBuffer()));
   assert.equal(actual.original.type,expected.original.type);assert.equal(actual.thumbnail.type,expected.thumbnail.type);
   assert.equal(actual.duration,expected.duration);assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
   assert.deepEqual(actual.annotations,expected.annotations);assert.deepEqual(actual.crop,expected.crop);
  }
  assert.equal((await decodeFullBackup(json)).kind,'notes');
 }
 assert.equal(JSON.parse(await model.encodeBackup([note([photo()])])).version,3);
});

test('full backups only require v4 when they include videos and retain settings',async()=>{
 const settings=state(),json=await encodeFullBackup([note([video(),photo()])],settings),wire=JSON.parse(json),restored=await decodeFullBackup(json);
 assert.equal(wire.version,4);assert.equal(wire.kind,'full');assert.equal(restored.kind,'full');
 assert.deepEqual(restored.state.preferences,settings.preferences);assert.deepEqual(restored.state.projects,settings.projects);
 assert.deepEqual(new Uint8Array(await restored.records[0].photos[0].original.arrayBuffer()),new Uint8Array([0,255,128,1,33]));
 assert.equal(JSON.parse(await encodeFullBackup([note([photo()])],settings)).version,3);
});

test('older backup versions reject video payloads and markers instead of dropping them',async()=>{
 const packedVideo={...video(),original:{type:'video/mp4',data:'AP+AASE='},thumbnail:{type:'image/jpeg',data:'c3RpbGw='}};
 const packedPhoto={...photo(),original:{type:'image/jpeg',data:'cGhvdG8='},thumbnail:{type:'image/png',data:'c3RpbGw='}};
 for(const clip of [packedVideo,{...packedPhoto,kind:'video'},{...packedVideo,kind:undefined}]) {
  for(const version of [1,2,3]) {
   const record=version===3?note([clip]):{...note(),photos:undefined,...clip,id:'note-1'};
   const wire={app:'rasd',version,kind:version===3?'notes':undefined,records:[record],state:state()};
   await assert.rejects(()=>decodeFullBackup(JSON.stringify(wire)),/video.*version 4/i);
   if(version!==2)await assert.rejects(()=>model.decodeBackup(JSON.stringify(wire)),/video.*version 4/i);
   if(version===3)await assert.rejects(()=>decodeFullBackup(JSON.stringify({...wire,kind:'full'})),/video.*version 4/i);
  }
 }
 for(const version of [1,2]) {
  const hidden={app:'rasd',version,records:[{...note(),...packedPhoto,id:'note-1',photos:[packedVideo]}],state:state()};
  await assert.rejects(()=>decodeFullBackup(JSON.stringify(hidden)),/video.*version 4/i);
 }
});

test('v4 decoding rejects corrupt media, metadata, unsupported kinds and duplicate IDs',async()=>{
 const valid=JSON.parse(await model.encodeBackup([note([photo(),video()])]));
 const cases=[x=>x.records[0].photos[1].original.data='bad!',x=>x.records[0].photos[1].original.type='video/avi',x=>x.records[0].photos[1].thumbnail.type='video/mp4',x=>x.records[0].photos[1].duration=61,x=>x.records[0].photos[1].width=0,x=>x.records[0].photos[1].annotations=[{type:'text',text:'bad'}],x=>x.records[0].photos[1].id='photo',x=>x.kind='unknown',x=>x.version=5];
 for(const mutate of cases){const wire=structuredClone(valid);mutate(wire);await assert.rejects(()=>decodeFullBackup(JSON.stringify(wire)));}
});

test('valid video files that exceed the backup budget fail without omitting media',async()=>{
 const source=video();source.original=new Blob([new Uint8Array(50*1024*1024)],{type:'video/mp4'});
 await assert.rejects(()=>model.encodeBackup([note([source])]),/64 MB/);
 await assert.rejects(()=>encodeFullBackup([note([source])],state()),/64 MB/);
});
