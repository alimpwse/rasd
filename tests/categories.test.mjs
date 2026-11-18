import test from 'node:test';
import assert from 'node:assert/strict';
import * as categoryModule from '../dist/categories.js';
import {validateRecord,encodeBackup,decodeBackup,shareText} from '../dist/model.js';
import {stampSections,DEFAULT_STAMP} from '../dist/stamp.js';
import {libraryView} from '../dist/library.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};};
const sample=()=>({id:'n1',createdAt:'2026-11-17T09:00:00Z',project:'Site',description:'ملاحظة عربية',address:{area:'',block:'',street:''},location:null,original:new Blob(['exact-original'],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/jpeg'}),annotations:[],stamp:{...DEFAULT_STAMP}});
test('Site Cleanliness retains the existing housekeeping category ID',()=>assert.equal(categoryModule.categoryLabel('housekeeping'),'Site Cleanliness'));
test('custom categories and selected default survive reload; rename keeps stable identity',()=>{
 assert.equal(typeof categoryModule.Categories,'function','editable category catalog is available');
 const storage=memory(),catalog=new categoryModule.Categories(storage);
 const id=catalog.add('أعمال الخرسانة');catalog.setDefault(id);catalog.rename(id,'Concrete works');
 const reopened=new categoryModule.Categories(storage);assert.equal(reopened.defaultId,id);assert.equal(reopened.label(id),'Concrete works');
 assert.equal(reopened.list().filter(x=>x.id===id).length,1);reopened.setDefault('');assert.equal(reopened.defaultId,'');
});
test('blank, duplicate and oversized category names fail without altering catalog',()=>{
 assert.equal(typeof categoryModule.Categories,'function');const catalog=new categoryModule.Categories(memory());
 const before=catalog.list();for(const name of ['','  ','safety','Site   Cleanliness','a'.repeat(61)])assert.throws(()=>catalog.add(name));
 assert.deepEqual(catalog.list(),before);assert.throws(()=>catalog.rename('housekeeping','Safety'));
 assert.throws(()=>catalog.setDefault('cat_missing'));assert.throws(()=>catalog.rename('cat_missing','New name'));
});
test('custom category label survives note backup, print, sharing and search on a fresh device',async()=>{
 const note={...sample(),category:'cat_test',categoryName:'ملاحظات خرسانة'};
 const [restored]=await decodeBackup(await encodeBackup([note]));
 assert.equal(restored.categoryName,note.categoryName);assert.equal(await restored.original.text(),'exact-original');
 assert.match(shareText(restored),/ملاحظات خرسانة/);assert.ok(stampSections(restored).some(x=>x.label==='CATEGORY'&&x.text===note.categoryName));
 assert.equal(libraryView([restored],{query:'خرسانة',category:'cat_test'}).count,1);
 const catalog=new categoryModule.Categories(memory());catalog.seed([restored]);assert.equal(catalog.label('cat_test'),note.categoryName);
 catalog.rename('cat_test','Concrete');catalog.seed([restored]);assert.equal(catalog.label('cat_test'),'Concrete','restore must preserve local rename');
});
test('custom categories require a valid name in backups; malformed data is rejected',()=>{
 for(const category of ['<script>',['safety'],{},null])assert.throws(()=>validateRecord({...sample(),category}));
 for(const categoryName of [undefined,'',12,[], 'a'.repeat(61)])assert.throws(()=>validateRecord({...sample(),category:'cat_test',categoryName}));
});
test('blocked catalog storage leaves an explicit add/default/rename unapplied',()=>{
 assert.equal(typeof categoryModule.Categories,'function');
 const catalog=new categoryModule.Categories({getItem:()=>null,setItem:()=>{throw new Error('blocked');}});
 assert.throws(()=>catalog.add('Concrete'),/save/i);assert.equal(catalog.list().length,3);
 assert.throws(()=>catalog.rename('safety','Safety checks'),/save/i);assert.equal(catalog.label('safety'),'Safety');
 assert.throws(()=>catalog.setDefault('safety'),/save/i);assert.equal(catalog.defaultId,'');
});
