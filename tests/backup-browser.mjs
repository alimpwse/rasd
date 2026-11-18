import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
const context=await browser.newContext({serviceWorkers:'block'});
await context.route('**/backup-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Backup storage checks</title>'}));
const open=async()=>{
 const page=await context.newPage();await page.goto(`${base}/backup-test.html`);
 await page.evaluate(async()=>{
  window.api=await import('./backup.js');window.db=await import('./storage.js');
  const {Preferences}=await import('./preferences.js'),{Categories}=await import('./categories.js'),{Projects}=await import('./projects.js');
  window.classes={Preferences,Categories,Projects};
  window.sample=id=>({id,createdAt:'2026-11-17T09:00:00Z',project:'Site',description:'Original',address:{area:'',block:'',street:''},location:null,original:new Blob([new Uint8Array([0,255,128,10])],{type:'image/jpeg'}),thumbnail:new Blob(['thumb'],{type:'image/png'}),annotations:[],category:'safety'});
  window.state={preferences:{...new Preferences().snapshot(),theme:'light'},categories:{entries:[{id:'safety',name:'Renamed Safety'},{id:'housekeeping',name:'Site Cleanliness'},{id:'cat_unused',name:'Unused category'}],defaultId:'cat_unused'},projects:{names:['Site','Unused project'],active:'Unused project'}};
  window.bundle=()=>({kind:'full',records:[sample('restored')],state:structuredClone(state)});
  window.errorOf=async work=>{try{await work();return null;}catch(error){return {message:error.message,pendingRestore:error.pendingRestore===true};}};
 });return page;
};
try {
 let page=await open();
 assert.equal(await page.evaluate(()=>typeof api.restoreFullBackup),'function','full restore API is available');
 assert.equal(await page.evaluate(()=>typeof api.recoverPendingRestore),'function','startup recovery API is available');
 await page.evaluate(async()=>{await api.recoverPendingRestore();await db.saveNote(sample('existing'));new classes.Projects().select('Previous project');});
 const unchanged=await page.evaluate(async()=>{
  const invalid=bundle();invalid.state.categories.defaultId='cat_missing';
  const failure=await errorOf(()=>api.restoreFullBackup(invalid));
  return {failure,ids:(await db.listNotes()).map(n=>n.id),projects:new classes.Projects().snapshot()};
 });
 assert.ok(unchanged.failure);assert.deepEqual(unchanged.ids,['existing']);assert.equal(unchanged.projects.active,'Previous project');
 const aborted=await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')throw new DOMException('Simulated quota','QuotaExceededError');return original.apply(this,args);};
  const failure=await errorOf(()=>api.restoreFullBackup(bundle()));IDBObjectStore.prototype.put=original;
  return {failure,ids:(await db.listNotes()).map(n=>n.id),recovered:await api.recoverPendingRestore(),projects:new classes.Projects().snapshot()};
 });
 assert.ok(aborted.failure);assert.deepEqual(aborted.ids,['existing']);assert.equal(aborted.recovered,false);assert.equal(aborted.projects.active,'Previous project');
 const stale=await open();await stale.evaluate(()=>db.listNotes());
 const success=await page.evaluate(async()=>{
  await api.restoreFullBackup(bundle());
  return {ids:(await db.listNotes()).map(n=>n.id),bytes:[...new Uint8Array(await (await db.listNotes())[0].original.arrayBuffer())],preferences:new classes.Preferences().snapshot(),categories:new classes.Categories().snapshot(),projects:new classes.Projects().snapshot(),pending:await api.recoverPendingRestore()};
 });
 assert.deepEqual(success.ids,['restored']);assert.deepEqual(success.bytes,[0,255,128,10]);assert.equal(success.preferences.theme,'light');assert.equal(success.categories.defaultId,'cat_unused');assert.equal(success.projects.active,'Unused project');assert.equal(success.pending,false);
 assert.match((await stale.evaluate(()=>errorOf(()=>db.saveNote(sample('stale'))))).message,/reload|restor/i);await stale.close();await page.close();
 // Each possible partial settings write must remain recoverable after a new document starts.
 for(const failKey of ['rasd-settings-v1','rasd-categories-v1','rasd-projects-v1','rasd-phrases-v1','rasd-restore-revision']) {
  page=await open();await page.evaluate(()=>api.recoverPendingRestore());
  const failure=await page.evaluate(async failKey=>{
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(key===failKey)throw new DOMException('Simulated blocked storage','QuotaExceededError');return original.call(this,key,value);};
   const incoming=bundle();incoming.records[0].id=`pending-${failKey}`;incoming.state.preferences.autoAddress=false;
   const failure=await errorOf(()=>api.restoreFullBackup(incoming));
   const blocked=await Promise.all([errorOf(()=>db.saveNote(sample('must-not-save'))),errorOf(()=>db.deleteNote(incoming.records[0].id)),errorOf(()=>db.importNotes([sample('must-not-import')]))]);
   const retry=await errorOf(()=>api.recoverPendingRestore());
   Storage.prototype.setItem=original;
   return {failure,blocked,retry,ids:(await db.listNotes()).map(n=>n.id)};
  },failKey);
  assert.equal(failure.failure?.pendingRestore,true);assert.ok(failure.blocked.every(Boolean));assert.equal(failure.retry?.pendingRestore,true);assert.deepEqual(failure.ids,[`pending-${failKey}`]);
  await page.close();page=await open();
  const recovered=await page.evaluate(async()=>({replayed:await api.recoverPendingRestore(),again:await api.recoverPendingRestore(),preferences:new classes.Preferences().snapshot(),categories:new classes.Categories().snapshot(),projects:new classes.Projects().snapshot()}));
  assert.equal(recovered.replayed,true);assert.equal(recovered.again,false);assert.equal(recovered.preferences.autoAddress,false);assert.equal(recovered.categories.defaultId,'cat_unused');assert.equal(recovered.projects.active,'Unused project');
  await page.evaluate(()=>db.saveNote(sample('after-recovery')));await page.close();
 }
 // A crash/failure after every localStorage write but before clearing the durable journal must replay too.
 page=await open();await page.evaluate(()=>api.recoverPendingRestore());
 const clearFailure=await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete=function(...args){if(this.name==='restore')throw new Error('Simulated interrupted journal completion');return original.apply(this,args);};
  const failure=await errorOf(()=>api.restoreFullBackup(bundle()));IDBObjectStore.prototype.delete=original;
  return failure;
 });assert.equal(clearFailure?.pendingRestore,true);await page.close();
 page=await open();assert.equal(await page.evaluate(()=>api.recoverPendingRestore()),true);
 await page.evaluate(()=>db.saveNote(sample('after-completion-recovery')));await page.close();
 console.log('PASS: full replacement, unchanged invalid/aborted restores, exact bytes, stale-window rejection, partial settings failures, persistent mutation gate and restart journal replay.');
} finally {await browser.close();}
