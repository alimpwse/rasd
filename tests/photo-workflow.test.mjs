import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord, encodeBackup, decodeBackup} from '../dist/model.js';
const sample=()=>({id:'n1',createdAt:'2026-11-17T09:00:00Z',project:'Site A',description:'ملاحظة عربية',address:{area:'السالمية',block:'5',street:'10'},location:null,original:new Blob(['original'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'}),annotations:[]});
test('legacy notes default to no printed information',()=>assert.equal(validateRecord(sample()).stamp.mode,'off'));
test('stamp configuration survives backup with Arabic and exact original bytes',async()=>{
 const r=sample();r.stamp={mode:'strip',date:true,time:false,location:true,note:true,project:true};
 const [restored]=await decodeBackup(await encodeBackup([r]));
 assert.deepEqual(restored.stamp,r.stamp);assert.equal(await restored.original.text(),'original');
 assert.equal(restored.description,r.description);
});
test('invalid stamp configuration fails before saving',()=>{
 for(const stamp of [{mode:'unknown'},{mode:'strip',date:'yes'},null])assert.throws(()=>validateRecord({...sample(),stamp}));
});
test('HEIC original is preserved without a lossy normalization step',async()=>{
 const r=sample();r.original=new Blob(['heic bytes'],{type:'image/heic'});
 const [restored]=await decodeBackup(await encodeBackup([r]));
 assert.equal(restored.original.type,'image/heic');assert.equal(await restored.original.text(),'heic bytes');
});

const {Projects}=await import('../dist/projects.js');
const {textDirection,stampSections,wrapText}=await import('../dist/stamp.js');
test('projects survive a reload and do not duplicate existing names',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const p=new Projects(storage);p.seed([{project:'Site A'},{project:'Site A'}]);p.select('مشروع ب');
 const reopened=new Projects(storage);assert.equal(reopened.active,'مشروع ب');assert.deepEqual(reopened.names,['Site A','مشروع ب']);
 reopened.select('Site A');assert.equal(new Projects(storage).active,'Site A');
});
test('Arabic, Latin and coordinates have independent writing directions',()=>{
 assert.equal(textDirection('ملاحظة A-12'),'rtl');assert.equal(textDirection('A-12 ملاحظة'),'ltr');assert.equal(textDirection('29.333, 48.083'),'ltr');
});
test('stamp toggles omit fields and wrap long tokens without losing text',()=>{
 const r={...sample(),stamp:{mode:'strip',date:false,time:false,location:false,note:true,project:false}};
 assert.deepEqual(stampSections(r),[{label:'NOTE',text:r.description}]);
 assert.equal(wrapText({measureText:s=>({width:s.length})},'a'.repeat(40),10).join(''),'a'.repeat(40));
});
