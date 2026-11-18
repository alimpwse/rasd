import test from 'node:test';
import assert from 'node:assert/strict';
import {shareText,formatDate,validateRecord,encodeBackup,decodeBackup} from '../dist/model.js';
import {stampSections,DEFAULT_STAMP} from '../dist/stamp.js';
import {noteTime} from '../dist/library.js';
import {Preferences} from '../dist/preferences.js';
const sample=()=>({id:'n1',createdAt:'2026-11-17T06:05:00Z',project:'Project Test',category:'safety',description:'ملاحظة عربية',address:{area:'Salmiya',block:'6',street:'10'},location:{latitude:29.333,longitude:48.083,accuracy:10,timestamp:'2026-11-17T06:05:00Z'},original:new Blob(['exact-original'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'}),annotations:[],stamp:{...DEFAULT_STAMP}});
const allOff={project:false,category:false,note:false,date:false,time:false,area:false,block:false,street:false,map:false};
test('Kuwait times use h:mm AM/PM with no leading hour zero or zone suffix',()=>{
 for(const [createdAt,expected] of [['2026-11-17T06:05:00Z','9:05 AM'],['2026-11-17T09:00:00Z','12:00 PM'],['2026-11-17T21:01:00Z','12:01 AM'],['2026-11-17T17:09:00Z','8:09 PM']]) {
  const record={...sample(),createdAt,stamp:{...DEFAULT_STAMP,date:false}};
  assert.equal(stampSections(record).find(s=>s.label==='RECORDED').text,expected);
  assert.equal(noteTime(createdAt),expected);assert.ok(formatDate(createdAt).includes(expected));assert.ok(!shareText(record).includes('KWT'));
 }
});
test('message field selection omits every excluded item independently of photo printing',()=>{
 const record={...sample(),export:{includeText:true,fields:{...allOff,note:true,block:true}}};
 assert.equal(shareText(record),'ملاحظة عربية\nBlock: 6');
 assert.ok(stampSections(record).some(s=>s.text.includes('Project Test')));
 assert.equal(shareText({...record,export:{includeText:true,fields:allOff}}),'');
 assert.equal(shareText({...record,export:{includeText:true,fields:{...allOff,time:true}}}),'9:05 AM');
 assert.match(shareText({...record,export:{includeText:true,fields:{...allOff,map:true}}}),/^https:\/\/maps.google.com\//);
});
test('legacy notes retain original ratio and all existing message fields',()=>{
 const record=validateRecord(sample());assert.deepEqual(record.crop,{ratio:'original'});
 assert.ok(Object.values(record.export.fields).every(x=>x===true));
 assert.match(shareText(record),/Project Test/);assert.match(shareText(record),/Area: Salmiya/);
});
test('crop and selective message fields survive backup with exact original and annotation coordinates',async()=>{
 const record={...sample(),crop:{ratio:'16:9'},export:{includeText:true,fields:{...allOff,note:true}},annotations:[{type:'text',x:.25,y:.4,color:'#ffffff',text:'Check'}]};
 const [restored]=await decodeBackup(await encodeBackup([record]));assert.deepEqual(restored.crop,record.crop);assert.deepEqual(restored.export,record.export);
 assert.deepEqual(restored.annotations,record.annotations);assert.equal(await restored.original.text(),'exact-original');
});
test('invalid crop and message fields reject a backup before it can be stored',()=>{
 for(const crop of [null,{ratio:'wide'},{ratio:['16:9']}])assert.throws(()=>validateRecord({...sample(),crop}));
 for(const fields of [null,[],{...allOff,note:'yes'}])assert.throws(()=>validateRecord({...sample(),export:{includeText:true,fields}}));
});
test('saved preferences without ratio/fields migrate without losing older choices',()=>{
 const data=new Map([['rasd-settings-v1',JSON.stringify({stamp:{...DEFAULT_STAMP,time:false},export:{includeText:false},autoAddress:false})]]);
 const p=new Preferences({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}),before=p.snapshot();
 assert.equal(before.photoRatio,undefined);assert.equal(before.stamp.time,false);assert.equal(before.autoAddress,false);
 p.save({...before,photoRatio:'16:9',export:{includeText:true,fields:{...allOff,note:true}}});
 const reopened=new Preferences({getItem:k=>data.get(k)}).snapshot();assert.equal(reopened.photoRatio,undefined,'legacy automatic crop default is no longer retained');assert.equal(reopened.export.fields.map,false);
});
test('16:9 crop retains maximum exact-ratio integer pixels in each orientation',async()=>{
 const {cropRect}=await import('../dist/framing.js');
 assert.deepEqual(cropRect(4032,3024,{ratio:'16:9'}),{x:0,y:378,width:4032,height:2268});
 assert.deepEqual(cropRect(3024,4032,{ratio:'16:9'}),{x:378,y:0,width:2268,height:4032});
 for(const [w,h] of [[4031,3023],[3023,4031],[1600,900],[900,1600],[1000,1000]]){
  const r=cropRect(w,h,{ratio:'16:9'});assert.equal(r.width/r.height,w>=h?16/9:9/16);
  assert.ok(r.x>=0 && r.y>=0 && r.width<=w && r.height<=h);
  assert.deepEqual(cropRect(w,h),{x:0,y:0,width:w,height:h});
 }
});
