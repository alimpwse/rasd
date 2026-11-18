import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Preferences} from '../dist/preferences.js';
import {encodeFullBackup,decodeFullBackup} from '../dist/backup.js';
const api=existsSync(new URL('../dist/phrases.js',import.meta.url))?await import('../dist/phrases.js'):{};
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const state=()=>({preferences:new Preferences(memory()).snapshot(),categories:{entries:[{id:'safety',name:'Safety'},{id:'housekeeping',name:'Site Cleanliness'},{id:'cat_custom',name:'Custom'}],defaultId:''},projects:{names:[],active:''}});

test('initial phrases are useful category observations with stable IDs and isolated snapshots',()=>{
 assert.equal(typeof api.Phrases,'function');
 const phrases=new api.Phrases(memory());
 assert.ok(phrases.list('safety').some(p=>p.text==='عدم الالتزام بإجراءات الأمن والسلامة.'));
 assert.ok(phrases.list('housekeeping').some(p=>p.text==='تنظيف الموقع.'));
 const before=phrases.snapshot(),again=new api.Phrases(memory()).snapshot();assert.deepEqual(before,again);
 before.entries[0].text='Changed';assert.notEqual(phrases.snapshot().entries[0].text,'Changed');
});

test('phrase CRUD preserves category IDs and Arabic text through reload',()=>{
 assert.equal(typeof api.Phrases,'function');
 const storage=memory(),phrases=new api.Phrases(storage);
 const id=phrases.add('cat_custom','  ممر غير آمن  ');
 assert.equal(phrases.list('cat_custom')[0].text,'ممر غير آمن');
 phrases.edit(id,'  يحتاج الممر إلى تنظيف  ');
 const reloaded=new api.Phrases(storage);assert.deepEqual(reloaded.list('cat_custom'),[{id,category:'cat_custom',text:'يحتاج الممر إلى تنظيف'}]);
 reloaded.add('','Observation without a category');assert.equal(reloaded.list('').length,1);
 reloaded.remove(id);assert.deepEqual(new api.Phrases(storage).list('cat_custom'),[]);
 assert.throws(()=>reloaded.edit(id,'Gone'));assert.throws(()=>reloaded.remove(id));
});

test('phrase normalization rejects invalid IDs, categories, duplicates, text and limits',()=>{
 assert.equal(typeof api.normalizePhrases,'function');
 const entry={id:'phrase-1',category:'safety',text:' Observation '};
 assert.deepEqual(api.normalizePhrases({entries:[entry]}),{entries:[{id:'phrase-1',category:'safety',text:'Observation'}]});
 const invalid=[null,{}, {entries:[entry],defaultsVersion:3},{entries:[entry],defaultsVersion:'2'}, {entries:[{...entry,id:''}]},{entries:[{...entry,id:'../bad'}]},{entries:[{...entry,id:'x'.repeat(81)}]},
  {entries:[entry,entry]},{entries:[{...entry,category:'Other'}]},{entries:[{...entry,category:undefined}]},{entries:[{...entry,text:'   '}]},{entries:[{...entry,text:'x'.repeat(301)}]},
  {entries:Array.from({length:21},(_,i)=>({...entry,id:`p${i}`}))},
  {entries:Array.from({length:1001},(_,i)=>({...entry,id:`p${i}`,category:`cat_${i}`}))}];
 for(const value of invalid)assert.throws(()=>api.normalizePhrases(value));
 assert.equal(api.normalizePhrases({entries:Array.from({length:20},(_,i)=>({...entry,id:`p${i}`}))}).entries.length,20);
});

test('blocked or malformed saved phrases retain usable initial observations',()=>{
 const blocked=new api.Phrases({getItem:()=>{throw new Error('Blocked');}});
 assert.equal(blocked.list('safety').length,3);
 const storage=memory();storage.setItem(api.PHRASES_KEY,'{"entries":[{"id":"bad"}]}');
 assert.equal(new api.Phrases(storage).list('housekeeping').length,3);
 storage.setItem(api.PHRASES_KEY,'{"entries":[]}');
 assert.deepEqual(new api.Phrases(storage).snapshot(),{defaultsVersion:2,entries:[]});
});

test('failed phrase writes retain previous in-memory and durable choices',()=>{
 assert.equal(typeof api.Phrases,'function');
 const storage=memory(),phrases=new api.Phrases(storage),id=phrases.add('cat_custom','Keep me');
 const before=phrases.snapshot();storage.setItem=()=>{throw new Error('Quota');};
 for(const change of [()=>phrases.add('cat_custom','New'),()=>phrases.edit(id,'Replacement'),()=>phrases.remove(id)]){
  assert.throws(change,/save|unchanged/i);assert.deepEqual(phrases.snapshot(),before);assert.deepEqual(new api.Phrases(storage).snapshot(),before);
 }
});

test('full v3 backups retain phrases and renamed category bindings and reject orphans',async()=>{
 const settings=state();settings.categories.entries[0].name='Renamed Safety';settings.phrases={entries:[{id:'saved',category:'safety',text:'Keep this'},{id:'custom',category:'cat_custom',text:'ملاحظة'},{id:'none',category:'',text:'Uncategorized'}]};
 const encoded=await encodeFullBackup([],settings),raw=JSON.parse(encoded);
 assert.equal(raw.version,3);assert.equal(raw.kind,'full');assert.deepEqual((await decodeFullBackup(encoded)).state,settings);
 const orphan=structuredClone(raw);orphan.state.phrases.entries[1].category='cat_missing';
 await assert.rejects(()=>decodeFullBackup(JSON.stringify(orphan)),/phrase|category/i);
 const invalid=structuredClone(raw);invalid.state.phrases.entries.push(invalid.state.phrases.entries[0]);
 await assert.rejects(()=>decodeFullBackup(JSON.stringify(invalid)),/phrase|duplicate/i);
});
