import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Preferences} from '../dist/preferences.js';
import {Categories} from '../dist/categories.js';
import {Projects} from '../dist/projects.js';
import {DEFAULT_PHRASES,LEGACY_PHRASES} from '../dist/phrases.js';
const backup=existsSync(new URL('../dist/backup.js',import.meta.url))?await import('../dist/backup.js'):{};
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};};
const defaults=()=>({preferences:new Preferences(memory()).snapshot(),categories:{entries:[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'},{id:'cat_site_works',name:'Site Works'}],defaultId:''},projects:{names:[],active:''},phrases:structuredClone(DEFAULT_PHRASES)});
const note=()=>({id:'original-note',createdAt:'2026-11-17T09:00:00Z',project:'Site',description:'ملاحظة',address:{area:'Salmiya',block:'6',street:'2'},location:null,original:new Blob([new Uint8Array([0,255,128,10,3])],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/png'}),annotations:[],category:'cat_used',categoryName:'Old category name'});

test('preferences default missing theme to dark and preserve an explicit light theme',()=>{
 const storage=memory(),preferences=new Preferences(storage);
 assert.equal(preferences.snapshot().theme,'dark');
 const old=preferences.snapshot();delete old.theme;preferences.save(old);assert.equal(preferences.snapshot().theme,'dark');
 preferences.save({...preferences.snapshot(),theme:'light'});assert.equal(new Preferences(storage).snapshot().theme,'light');
 assert.throws(()=>preferences.save({...preferences.snapshot(),theme:'system'}),/theme/i);
});

test('catalog and project snapshots retain unused entries and selected defaults independently',()=>{
 const storage=memory(),categories=new Categories(storage),projects=new Projects(storage);
 const unused=categories.add('Unused category');categories.rename('safety','Safety checks');categories.setDefault(unused);
 projects.select('Unused project');projects.select('Active project');
 assert.equal(typeof categories.snapshot,'function');assert.equal(typeof projects.snapshot,'function');
 const snapshot=categories.snapshot();assert.deepEqual(snapshot,{entries:[{id:'safety',name:'Safety checks'},{id:'housekeeping',name:'Site Cleanliness'},{id:'cat_site_works',name:'Site Works'},{id:unused,name:'Unused category'}],defaultId:unused});
 snapshot.entries[0].name='Changed';assert.equal(categories.label('safety'),'Safety checks');
 const projectSnapshot=projects.snapshot();assert.deepEqual(projectSnapshot,{names:['Unused project','Active project'],active:'Active project'});
 projectSnapshot.names.push('Changed');assert.equal(projects.names.length,2);
});

test('full backups preserve exact photo bytes, unused catalog entries, selections and all preferences',async()=>{
 assert.equal(typeof backup.encodeFullBackup,'function');
 const state=defaults();state.preferences.theme='light';state.preferences.autoAddress=false;state.preferences.export.includeText=false;
 state.categories.entries[0].name='Renamed Safety';state.categories.entries.push({id:'cat_used',name:'Current category name'},{id:'cat_unused',name:'Unused category'});state.categories.defaultId='cat_unused';
 state.projects={names:['Site','Unused project'],active:'Unused project'};
 const encoded=await backup.encodeFullBackup([note()],state),raw=JSON.parse(encoded);
 assert.equal(raw.version,3);assert.equal(raw.kind,'full');assert.equal(raw.app,'rasd');
 const restored=await backup.decodeFullBackup(encoded);
 assert.equal(restored.kind,'full');assert.deepEqual(restored.state,state);
 assert.deepEqual(new Uint8Array(await restored.records[0].original.arrayBuffer()),new Uint8Array([0,255,128,10,3]));
 assert.equal(restored.records[0].categoryName,'Old category name');
});

test('a full backup with no photos retains configuration and missing theme defaults to dark',async()=>{
 assert.equal(typeof backup.encodeFullBackup,'function');
 const state=defaults(),raw=JSON.parse(await backup.encodeFullBackup([],state));delete raw.state.preferences.theme;delete raw.state.phrases;
 const result=await backup.decodeFullBackup(JSON.stringify(raw));assert.deepEqual(result.records,[]);assert.equal(result.state.preferences.theme,'dark');
 assert.deepEqual(result.state.categories,state.categories);assert.deepEqual(result.state.projects,{names:[],active:''});assert.deepEqual(result.state.phrases,LEGACY_PHRASES);
});

test('legacy note-only backups remain recognizable for merge without manufacturing settings',async()=>{
 assert.equal(typeof backup.decodeFullBackup,'function');
 const record=note();record.original={type:'image/jpeg',data:'AP+ACgM='};record.thumbnail={type:'image/png',data:'dGh1bWI='};
 const result=await backup.decodeFullBackup(JSON.stringify({app:'rasd',version:1,records:[record]}));
 assert.equal(result.kind,'legacy');assert.equal(result.state,undefined);assert.equal(result.records[0].project,'Site');
});

test('full backups reject invalid settings, duplicate catalogs, dangling references and excessive counts',async()=>{
 assert.equal(typeof backup.encodeFullBackup,'function');
 const state=defaults();state.categories.entries.push({id:'cat_used',name:'Current category name'});state.projects={names:['Site'],active:'Site'};
 const valid=JSON.parse(await backup.encodeFullBackup([note()],state));
 const cases=[
  x=>{x.state.preferences.theme='system';},x=>{x.state.preferences.autoAddress='yes';},x=>{x.state.preferences.stamp=null;},x=>{delete x.state.preferences.export;},
  x=>{x.state.categories.entries.push({...x.state.categories.entries[0]});},
  x=>{x.state.categories.entries=x.state.categories.entries.filter(e=>e.id!=='housekeeping');},x=>{x.state.categories.defaultId='cat_missing';},x=>{x.records[0].category='cat_missing';},
  x=>{x.state.projects.names=['Site','Site'];},x=>{x.state.projects.active='Absent';},x=>{x.records[0].project='Absent';},
  x=>{x.records.push({...x.records[0]});},x=>{x.records=Array.from({length:501},(_,i)=>({...x.records[0],id:`note-${i}`}));},
  x=>{x.state.projects.names=Array.from({length:1001},(_,i)=>`Project ${i}`);},x=>{x.state.categories.entries.push({id:'cat_wrong',name:'x'.repeat(61)});},
 ];
 for(const mutate of cases){const invalid=structuredClone(valid);mutate(invalid);await assert.rejects(()=>backup.decodeFullBackup(JSON.stringify(invalid)));}
 await assert.rejects(()=>backup.encodeFullBackup([note()],defaults()),/category|project/i);
});

test('independent legacy categories with equal names and preserved project whitespace can be fully backed up',async()=>{
 const storage=memory(),categories=new Categories(storage),projects=new Projects(storage);
 const local=categories.add('Electrical');
 const imported=[{...note(),category:'cat_imported',categoryName:'Electrical',project:' Site '},{...note(),id:'legacy-label',category:'cat_legacy',categoryName:'Uncategorized',project:' Site '}];
 categories.seed(imported);projects.seed(imported);
 const state={...defaults(),categories:categories.snapshot(),projects:projects.snapshot()};
 const result=await backup.decodeFullBackup(await backup.encodeFullBackup(imported,state));
 assert.equal(result.state.categories.entries.find(x=>x.id===local).name,'Electrical');
 assert.equal(result.state.categories.entries.find(x=>x.id==='cat_imported').name,'Electrical');
 assert.equal(result.state.categories.entries.find(x=>x.id==='cat_legacy').name,'Uncategorized');
 assert.equal(result.records[0].project,' Site ');assert.deepEqual(result.state.projects.names,[' Site ']);
});
