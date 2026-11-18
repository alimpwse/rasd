import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
try{
for(const writerVersion of [3,4]){
const context=await browser.newContext({serviceWorkers:'block'});
await context.route('**/migration-fixture.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Photo migration</title>'}));
const base=process.env.TEST_URL || 'http://127.0.0.1:4173',old=await context.newPage(),modern=await context.newPage();
try{
 await old.goto(`${base}/migration-fixture.html`);await modern.goto(`${base}/migration-fixture.html`);
 await old.evaluate(async writerVersion=>{
  window.legacy={id:'legacy',createdAt:'2026-11-17T09:00:00Z',project:'',description:'Original note',address:{area:'',block:'',street:''},location:null,original:new Blob(['image'],{type:'image/png'}),thumbnail:new Blob(['thumb'],{type:'image/png'}),annotations:[]};
  if(writerVersion===4)legacy.photos=[{id:'one',original:legacy.original,thumbnail:legacy.thumbnail,annotations:[],crop:{ratio:'original'}}];
  window.openOld=()=>new Promise((resolve,reject)=>{if(window.oldDB){resolve(window.oldDB);return;}const r=indexedDB.open('rasd-field-notes',writerVersion);r.onupgradeneeded=()=>{r.result.createObjectStore('notes',{keyPath:'id'});r.result.createObjectStore('restore');r.result.createObjectStore('drafts',{keyPath:'id'});};r.onerror=()=>reject(r.error);r.onsuccess=()=>{window.oldDB=r.result;oldDB.onversionchange=()=>{oldDB.close();window.oldDB=null;};resolve(oldDB);};});
  const db=await openOld();await new Promise((resolve,reject)=>{const tx=db.transaction('notes','readwrite');tx.objectStore('notes').put(legacy);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 },writerVersion);
 await modern.evaluate(async()=>{const {listNotes}=await import('./storage.js');await listNotes();});
 const rejectedBeforeWrite=await old.evaluate(async()=>{try{await openOld();return false;}catch(error){return error.name==='VersionError';}});
 assert.equal(rejectedBeforeWrite,true,`version ${writerVersion} writers must be blocked by the new database version`);
 await modern.evaluate(async()=>{
  const storage=await import('./storage.js');const note=(await storage.listNotes())[0];
  await storage.saveNote({...note,photos:[{id:'one',original:note.original,thumbnail:note.thumbnail,annotations:[],crop:{ratio:'original'}},{id:'two',original:new Blob(['second'],{type:'image/png'}),thumbnail:note.thumbnail,annotations:[],crop:{ratio:'original'}}]});
 });
 const blocked=await old.evaluate(async()=>{try{const db=await openOld();await new Promise((resolve,reject)=>{const tx=db.transaction('notes','readwrite');tx.objectStore('notes').put({...legacy,description:'Stale single-photo overwrite'});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});return false;}catch(error){return error.name==='VersionError';}});
 assert.equal(blocked,true,'an old single-photo app must not silently erase the extra photos');
 const current=await modern.evaluate(async()=>{const {listNotes}=await import('./storage.js');return(await listNotes())[0];});assert.equal(current.photos.length,2);assert.equal(current.description,'Original note');
 if(writerVersion===4){
  await modern.evaluate(async()=>{
   const storage=await import('./storage.js'),note=(await storage.listNotes())[0];
   await storage.saveNote({...note,photos:[{id:'clip',kind:'video',original:new Blob(['exact video bytes'],{type:'video/mp4'}),thumbnail:new Blob(['poster'],{type:'image/jpeg'}),duration:1,width:1920,height:1080,annotations:[],crop:{ratio:'original'}},...note.photos]});
  });
  assert.equal(await old.evaluate(async()=>{try{await openOld();return false;}catch(error){return error.name==='VersionError';}}),true);
  await modern.reload();
  const restored=await modern.evaluate(async()=>{const {listNotes}=await import('./storage.js'),note=(await listNotes())[0];return {count:note.photos.length,kind:note.photos[0].kind,bytes:await note.photos[0].original.text(),alias:await note.original.text()};});
  assert.deepEqual(restored,{count:3,kind:'video',bytes:'exact video bytes',alias:'exact video bytes'});
 }
 console.log(`PASS: legacy data survives upgrade and version ${writerVersion} windows cannot overwrite newer media notes.`);
}finally{await context.close();}
}
}finally{await browser.close();}
