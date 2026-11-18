import test from 'node:test';
import assert from 'node:assert/strict';
import {Preferences} from '../dist/preferences.js';
import {Phrases,PHRASES_KEY} from '../dist/phrases.js';
import {Categories,CATEGORIES_KEY} from '../dist/categories.js';
import {shareText} from '../dist/model.js';
import {stampSections} from '../dist/stamp.js';
import {encodeFullBackup,decodeFullBackup} from '../dist/backup.js';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const legacy={entries:[{id:'safety-ppe',category:'safety',text:'Required PPE is not being used.'},{id:'safety-opening',category:'safety',text:'An opening needs a protective barrier.'},{id:'safety-access',category:'safety',text:'Access is obstructed.'},{id:'housekeeping-debris',category:'housekeeping',text:'Construction debris needs to be removed.'},{id:'housekeeping-cleaning',category:'housekeeping',text:'The work area needs cleaning.'},{id:'housekeeping-materials',category:'housekeeping',text:'Materials need to be stored neatly.'}]};
const expected={stamp:{mode:'strip',date:true,time:true,location:true,note:false,project:false,category:false,address:{area:false,block:true,street:true}},export:{includeText:true,fields:{project:false,category:false,note:true,date:false,time:false,area:false,block:true,street:true,map:true}},autoAddress:true,theme:'dark'};
test('fresh defaults exactly match the approved screenshots and affect only new preferences',()=>{
 const storage=memory(),p=new Preferences(storage);assert.deepEqual(p.snapshot(),expected);
 const custom={...p.snapshot(),theme:'light',autoAddress:false,stamp:{...p.snapshot().stamp,note:true,address:{area:true,block:false,street:false}}};p.save(custom);assert.deepEqual(new Preferences(storage).snapshot(),custom);
 const note={createdAt:'2026-11-18T05:54:00Z',project:'Hidden project',category:'safety',description:'تنظيف الموقع.',address:{area:'Hidden area',block:'5',street:'10'},location:{latitude:29.333,longitude:48.083},...{stamp:p.snapshot().stamp,export:expected.export}};
 const sections=stampSections({...note,stamp:expected.stamp});assert.deepEqual(sections.map(x=>x.label),['RECORDED','LOCATION']);assert.equal(sections[1].text,'Block 5 · Street 10');
 assert.equal(shareText(note),'تنظيف الموقع.\nBlock: 5\nStreet: 10\nhttps://maps.google.com/?q=29.333%2C48.083');
});
test('approved Arabic phrases have the intended categories and exact user wording',()=>{
 const p=new Phrases(memory()),c=new Categories(memory());
 assert.deepEqual(p.list('safety').map(x=>x.text),['عدم الالتزام بإجراءات الأمن والسلامة.','الحواجز غير مغلقة بإحكام.','الحواجز غير كافية لتأمين الموقع.']);
 assert.deepEqual(p.list('housekeeping').map(x=>x.text),['إزالة الأنقاض.','تنظيف الموقع.','إزالة البايبات.']);
 assert.equal(c.label('cat_site_works'),'Site Works');assert.deepEqual(p.list('cat_site_works').map(x=>x.text),['فرش طبقة ميلينق.']);assert.ok(p.snapshot().entries.every(x=>!x.text.includes('يلزم')));
});
test('legacy presets upgrade once, retaining custom edits and deleted defaults',()=>{
 const storage=memory(),saved=structuredClone(legacy);saved.entries[0].text='عبارة خاصة';saved.entries=saved.entries.filter(x=>x.id!=='safety-opening');saved.entries.push({id:'custom',category:'housekeeping',text:'تنظيف خاص'});storage.setItem(PHRASES_KEY,JSON.stringify(saved));
 const p=new Phrases(storage);assert.equal(p.list('safety').find(x=>x.id==='safety-ppe').text,'عبارة خاصة');assert.ok(!p.snapshot().entries.some(x=>x.id==='safety-opening'));assert.ok(p.list('housekeeping').some(x=>x.id==='custom'));assert.ok(p.list('housekeeping').some(x=>x.text==='إزالة البايبات.'));assert.equal(p.list('cat_site_works').length,1);
 p.remove('siteworks-milling');assert.equal(new Phrases(storage).list('cat_site_works').length,0);assert.equal(p.snapshot().defaultsVersion,2);
 const clean=memory();clean.setItem(PHRASES_KEY,JSON.stringify({entries:[]}));assert.equal(new Phrases(clean).snapshot().entries.length,0);
});
test('phrase version and deleted milling survive full backup restore; two-category legacy backups still load',async()=>{
 const storage=memory(),p=new Phrases(storage);p.remove('siteworks-milling');
 const state={preferences:new Preferences(storage).snapshot(),categories:new Categories(storage).snapshot(),projects:{names:[],active:''},phrases:p.snapshot()};
 const decoded=await decodeFullBackup(await encodeFullBackup([],state));assert.deepEqual(decoded.state,state);const restored=memory();restored.setItem(PHRASES_KEY,JSON.stringify(decoded.state.phrases));assert.equal(new Phrases(restored).list('cat_site_works').length,0);
 const old=JSON.stringify({app:'rasd',version:2,records:[],state:{preferences:expected,categories:{entries:[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'}],defaultId:''},projects:{names:[],active:''}}});
 const previous=await decodeFullBackup(old);assert.deepEqual(previous.state.phrases,legacy);restored.setItem(PHRASES_KEY,JSON.stringify(previous.state.phrases));assert.equal(new Phrases(restored).list('cat_site_works').length,1);
});
test('preset upgrades remain usable with blocked writes and respect full category capacity',()=>{
 const original=JSON.stringify(legacy),blocked={getItem:()=>original,setItem:()=>{throw new Error('quota');}};
 const p=new Phrases(blocked);assert.equal(p.list('housekeeping')[2].text,'إزالة البايبات.');assert.equal(blocked.getItem(PHRASES_KEY),original);
 const full=structuredClone(legacy);full.entries.push(...Array.from({length:20},(_,i)=>({id:`works-${i}`,category:'cat_site_works',text:`Work ${i}`})));
 const storage=memory();storage.setItem(PHRASES_KEY,JSON.stringify(full));const upgraded=new Phrases(storage);
 assert.equal(upgraded.list('cat_site_works').length,20);assert.equal(upgraded.list('safety')[0].text,'عدم الالتزام بإجراءات الأمن والسلامة.');
 assert.equal(JSON.parse(storage.getItem(PHRASES_KEY)).defaultsVersion,2);
});
test('Site Works preset is distinguishable from existing names without changing their identities',()=>{
 const storage=memory(),entries=[{id:'cat_existing',name:'Site Works'},{id:'cat_other',name:'Site Works (default)'}];
 storage.setItem(CATEGORIES_KEY,JSON.stringify({entries,defaultId:'cat_existing'}));
 const catalog=new Categories(storage);
 assert.equal(catalog.label('cat_site_works'),'Site Works (default 2)');assert.equal(catalog.label('cat_existing'),'Site Works');assert.equal(catalog.defaultId,'cat_existing');
 assert.deepEqual(catalog.snapshot().entries.filter(x=>entries.some(e=>e.id===x.id)),entries);
 catalog.rename('cat_site_works','Road works');assert.equal(new Categories(storage).label('cat_site_works'),'Road works');
});
test('adding Site Works preserves the full-backup capacity of a maximum-size old catalog',async()=>{
 const entries=[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'},...Array.from({length:998},(_,i)=>({id:`cat_legacy_${i}`,name:`Legacy ${i}`}))];
 const state={preferences:expected,categories:{entries,defaultId:'cat_legacy_0'},projects:{names:[],active:''},phrases:legacy};
 const restored=await decodeFullBackup(await encodeFullBackup([],state)),storage=memory();storage.setItem(CATEGORIES_KEY,JSON.stringify(restored.state.categories));
 const upgraded={...restored.state,categories:new Categories(storage).snapshot()};assert.equal(upgraded.categories.entries.length,1001);
 const roundtrip=await decodeFullBackup(await encodeFullBackup([],upgraded));assert.deepEqual(roundtrip.state.categories,upgraded.categories);
 const tooMany=structuredClone(upgraded);tooMany.categories.entries.push({id:'cat_excess',name:'Excess'});await assert.rejects(()=>encodeFullBackup([],tooMany),/categories/);
 tooMany.categories.entries=tooMany.categories.entries.filter(e=>e.id!=='cat_site_works');await assert.rejects(()=>encodeFullBackup([],tooMany),/categories/);
});
