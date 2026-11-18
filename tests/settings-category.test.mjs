import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord,encodeBackup,decodeBackup,shareText} from '../dist/model.js';
import {libraryView} from '../dist/library.js';
import {stampSections,DEFAULT_STAMP} from '../dist/stamp.js';
const sample=()=>({id:'n1',createdAt:'2026-11-17T09:00:00Z',project:'Site',description:'ملاحظة عربية',address:{area:'Salmiya',block:'6',street:'Al-Khansa'},location:null,original:new Blob(['exact-original'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'}),annotations:[]});
test('old notes remain uncategorized and preserve old printing behavior',()=>{
 const note=validateRecord(sample());assert.equal(note.category,'');assert.equal(note.export.includeText,true);assert.ok(Object.values(note.export.fields).every(Boolean));assert.equal(note.stamp.mode,'off');
});
test('category and per-photo sharing choices survive backup without changing original',async()=>{
 const note={...sample(),category:'safety',export:{includeText:false},stamp:{...DEFAULT_STAMP,category:true}};
 const [restored]=await decodeBackup(await encodeBackup([note]));
 assert.equal(restored.category,'safety');assert.equal(restored.export.includeText,false);assert.equal(await restored.original.text(),'exact-original');
 assert.match(shareText(restored),/Safety/);assert.ok(stampSections(restored).some(s=>s.label==='CATEGORY'&&s.text==='Safety'));
});
test('invalid categories and export types fail before storing or restoring',()=>{
 assert.throws(()=>validateRecord({...sample(),category:'<script>'}));
 assert.throws(()=>validateRecord({...sample(),category:['safety']}));
 assert.throws(()=>validateRecord({...sample(),export:{includeText:'yes'}}));
});
test('category filter combines with project and Arabic search; absent means uncategorized',()=>{
 const notes=[{...sample(),id:'a',category:'safety'},{...sample(),id:'b',category:'housekeeping'},{...sample(),id:'c'}];
 assert.deepEqual(libraryView(notes,{category:'safety',project:'Site',query:'عربية'}).groups.flatMap(g=>g.notes.map(n=>n.id)),['a']);
 assert.equal(libraryView(notes,{category:''}).count,1);
 assert.equal(libraryView(notes,{query:'Site Cleanliness'}).count,1);
});
