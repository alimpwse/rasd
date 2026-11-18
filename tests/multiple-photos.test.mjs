import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../dist/model.js';
import {encodeFullBackup,decodeFullBackup} from '../dist/backup.js';
import {Preferences} from '../dist/preferences.js';

const photo=(id='photo-1',body=id)=>({id,original:new Blob([body],{type:'image/jpeg'}),thumbnail:new Blob([`thumb-${id}`],{type:'image/png'}),annotations:[],crop:{ratio:'original'}});
const note=(photos=[photo()])=>({id:'note-1',createdAt:'2026-11-17T09:00:00Z',project:'',description:'وصف مشترك',address:{area:'',block:'',street:''},location:null,photos});
const old=()=>{const {id,...image}=photo();return {...note(),photos:undefined,...image};};
const state=()=>({preferences:new Preferences({getItem:()=>null}).snapshot(),categories:{entries:[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'}],defaultId:''},projects:{names:[],active:''}});
const legacyWire=()=>({app:'rasd',version:1,records:[{...old(),original:{type:'image/jpeg',data:'b2xk'},thumbnail:{type:'image/png',data:'dGh1bWI='}}]});

test('legacy notes expose a stable first photo and validation creates first-photo aliases',()=>{
 assert.equal(typeof model.photosOf,'function');
 const before=old(),photos=model.photosOf(before),clean=model.validateRecord(before);
 assert.equal(photos[0].id,'photo-1');assert.equal(clean.photos.length,1);
 assert.equal(clean.original,clean.photos[0].original);assert.equal(clean.thumbnail,clean.photos[0].thumbnail);
 assert.deepEqual(clean.crop,{ratio:'original'});assert.deepEqual(clean.annotations,[]);
});

test('canonical photo order owns crop and annotations independently of stale root aliases',()=>{
 const first=photo('one'),second=photo('two');second.crop={ratio:'16:9'};
 second.annotations=[{type:'text',x:.2,y:.4,color:'#ffffff',text:'الحماية',scale:1.4}];
 const record={...note([first,second]),original:new Blob(['stale'],{type:'text/html'}),annotations:[{type:'invalid'}]};
 const clean=model.validateRecord(record);
 assert.deepEqual(clean.photos.map(p=>p.id),['one','two']);assert.equal(clean.original,first.original);
 assert.deepEqual(clean.photos[0].annotations,[]);assert.equal(clean.photos[1].annotations[0].text,'الحماية');
 assert.deepEqual(clean.photos[1].crop,{ratio:'16:9'});assert.deepEqual(clean.crop,{ratio:'original'});
});

test('validates every photo, distinct IDs, count, byte budget, markup and crop',()=>{
 const cases=[
  x=>x.photos=[],x=>x.photos=null,x=>x.photos=Array.from({length:11},(_,i)=>photo(`p${i}`)),
  x=>x.photos[1].id=x.photos[0].id,x=>x.photos[1].id='../bad',x=>x.photos[1].id='x'.repeat(81),
  x=>x.photos[1].original=new Blob(['bad'],{type:'text/html'}),x=>x.photos[1].thumbnail=new Blob([],{type:'image/jpeg'}),
  x=>x.photos[1].original=new Blob([new Uint8Array(25*1024*1024+1)],{type:'image/jpeg'}),
  x=>x.photos=Array.from({length:5},(_,i)=>({...photo(`p${i}`),original:new Blob([new Uint8Array(21*1024*1024)],{type:'image/jpeg'})})),
  x=>x.photos[1].annotations=Array.from({length:201},()=>({type:'text',x:0,y:0,color:'#ffffff',text:'x'})),
  x=>x.photos[1].annotations=[{type:'text',x:0,y:0,color:'#ffffff',text:'x',scale:4}],x=>x.photos[1].crop={ratio:'square'}
 ];
 assert.equal(model.validateRecord(note(Array.from({length:10},(_,i)=>photo(`p${i}`)))).photos.length,10);
 for(const mutate of cases){const record=note([photo('one'),photo('two')]);mutate(record);assert.throws(()=>model.validateRecord(record));}
});

test('v3 note backups preserve all photo bytes in order without duplicate root payloads',async()=>{
 const photos=[photo('one','first bytes'),photo('two','second bytes')];photos[1].crop={ratio:'16:9'};
 const json=await model.encodeBackup([note(photos)]),raw=JSON.parse(json);
 assert.equal(raw.version,3);assert.equal(raw.kind,'notes');
 assert.equal(Object.hasOwn(raw.records[0],'original'),false);assert.equal(Object.hasOwn(raw.records[0],'thumbnail'),false);
 assert.equal(Object.hasOwn(raw.records[0],'annotations'),false);assert.equal(Object.hasOwn(raw.records[0],'crop'),false);
 const [restored]=await model.decodeBackup(json);
 assert.deepEqual(await Promise.all(restored.photos.map(p=>p.original.text())),['first bytes','second bytes']);
 assert.deepEqual(restored.photos[1].crop,{ratio:'16:9'});assert.equal(await restored.original.text(),'first bytes');
 assert.equal((await decodeFullBackup(json)).kind,'notes');
});

test('genuine v1 notes and v2 full backups migrate to a canonical photo collection',async()=>{
 const legacy=legacyWire(),[record]=await model.decodeBackup(JSON.stringify(legacy));
 assert.equal(record.photos.length,1);assert.equal(await record.photos[0].original.text(),'old');
 assert.equal((await decodeFullBackup(JSON.stringify(legacy))).kind,'legacy');
 const full=await decodeFullBackup(JSON.stringify({...legacy,version:2,state:state()}));
 assert.equal(full.kind,'full');assert.equal(await full.records[0].photos[0].original.text(),'old');
 assert.ok(full.state.phrases.entries.length>0);
});

test('full backups preserve each photo crop and markup with shared note metadata',async()=>{
 const first=photo('one','first'),second=photo('two','second');second.crop={ratio:'16:9'};
 second.annotations=[{type:'ellipse',x:.2,y:.3,x2:.5,y2:.6,color:'#ffc44a'}];
 const record=note([first,second]),settings=state();settings.phrases={entries:[{id:'custom-observation',category:'safety',text:'حاجز حماية'}]};
 const result=await decodeFullBackup(await encodeFullBackup([record],settings));
 assert.equal(result.records[0].description,'وصف مشترك');
 assert.deepEqual(await Promise.all(result.records[0].photos.map(p=>p.original.text())),['first','second']);
 assert.deepEqual(result.records[0].photos[0].annotations,[]);
 assert.deepEqual(result.records[0].photos[1].annotations,[{type:'ellipse',x:.2,y:.3,x2:.5,y2:.6,color:'#ffc44a'}]);
 assert.deepEqual(result.records[0].photos[1].crop,{ratio:'16:9'});
 assert.equal(result.state.phrases.entries[0].text,'حاجز حماية');
});

test('backup validation rejects corrupt later photos, duplicates, trailing JSON and unknown kinds',async()=>{
 const valid=JSON.parse(await model.encodeBackup([note([photo('one'),photo('two')])]));
 const cases=[x=>x.records[0].photos[1].original.data='bad!',x=>x.records[0].photos[1].id='one',x=>x.records.push(x.records[0]),x=>x.records[0].photos=[],x=>x.kind='unknown'];
 for(const mutate of cases){const invalid=structuredClone(valid);mutate(invalid);await assert.rejects(()=>model.decodeBackup(JSON.stringify(invalid)));}
 await assert.rejects(()=>model.decodeBackup(`${JSON.stringify(valid)} trailing`));
});

test('all originals count toward the existing backup size limit',async()=>{
 const big=new Blob([new Uint8Array(25*1024*1024)],{type:'image/jpeg'});
 const record=note([{...photo('one'),original:big},{...photo('two'),original:big}]);
 await assert.rejects(()=>model.encodeBackup([record]),/64 MB/);
 await assert.rejects(()=>encodeFullBackup([record],state()),/64 MB/);
});
