import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});
await context.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
try{
 await page.goto(base);const bytes=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;return c.toDataURL().split(',')[1];}),'base64'),photo={name:'site.png',mimeType:'image/png',buffer:bytes};
 await page.locator('#photo-input').setInputFiles(photo);await page.locator('#description').fill('Keep this note if saving fails');await page.locator('#category').selectOption('safety');
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Draft saved'));
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')throw new DOMException('Test quota','QuotaExceededError');return window.originalPut.apply(this,args);};});
 await page.locator('#save-next').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Storage is full'));
 assert.equal(await page.locator('#note-dialog').isVisible(),true);assert.equal(await page.locator('#next-note-banner').isVisible(),false);assert.equal(await page.locator('#description').inputValue(),'Keep this note if saving fails');
 const failed=await page.evaluate(async()=>{const s=await import('./storage.js');return {notes:(await s.listNotes()).length,drafts:(await s.listDrafts()).length};});assert.equal(failed.notes,0);assert.equal(failed.drafts,1);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});await page.locator('#save-next').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await page.locator('#photo-input').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('broken image')});await page.waitForFunction(()=>!document.querySelector('#shutter').disabled);assert.equal(await page.locator('#next-note-banner').isVisible(),true,'decode failure retains next-note context');
 await page.locator('#active-project').selectOption('');await page.reload();await page.locator('#photo-input').setInputFiles(photo);await page.locator('#note-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#category').inputValue(),'','pending category never becomes a global default');await page.locator('#close-note').click();
 await page.locator('#nav-archive').click();await page.locator('.note-open').click();await page.locator('#note-dialog').waitFor({state:'visible'});
 await page.evaluate(async()=>{const s=await import('./storage.js');await s.deleteNote((await s.listNotes())[0].id);});await page.locator('#save-next').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('another window'));
 assert.equal(await page.locator('#note-dialog').isVisible(),true,'deleted saved notes cannot advance or be resurrected');assert.equal(await page.evaluate(async()=>(await (await import('./storage.js')).listNotes()).length),0);
 const guarded=await context.newPage();await guarded.goto(base);await guarded.locator('#photo-input').setInputFiles(photo);await guarded.locator('#description').fill('Restore-gated note');
 await guarded.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')this.transaction.savedRecord=true;return put.apply(this,args);};const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get:d.get,set(callback){d.set.call(this,function(event){if(this.savedRecord){window.commitPaused=true;window.releaseCommit=()=>callback.call(this,event);}else callback.call(this,event);});}});});
 await guarded.locator('#save-next').click();await guarded.waitForFunction(()=>window.commitPaused);await guarded.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'rasd-restore-revision',newValue:'test-restore'})));await guarded.locator('#data-status-dialog').waitFor({state:'visible'});await guarded.evaluate(()=>window.releaseCommit());await guarded.waitForFunction(()=>!document.querySelector('#save-next').disabled);
 assert.equal(await guarded.locator('#data-status-dialog').isVisible(),true);assert.equal(await guarded.locator('#next-note-banner').isVisible(),false,'restoration gate prevents capture advance');assert.equal(await guarded.locator('#note-dialog').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('PASS: quota failure keeps editor/draft, retry advances once, decode failure retains context, reload restores defaults, deleted-note conflict and restore gate block advancement.');
}finally{await browser.close();}
