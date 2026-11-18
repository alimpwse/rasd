import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844}});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
try {
 await page.goto(base);
 const bytes=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const x=c.getContext('2d');x.fillStyle='#b8b4ab';x.fillRect(0,0,1200,900);return c.toDataURL().split(',')[1];});
 const photo={name:'original.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')};
 await page.locator('#photo-input').setInputFiles(photo);
 await page.locator('#description').fill('ملاحظة محفوظة تلقائياً');await page.locator('#block').fill('7');
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 assert.equal(await page.evaluate(async()=>{const s=await import('./storage.js');return(await s.listNotes()).length;}),0);
 // A fresh page recovers the exact local photo and metadata, without an explicit Save.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await context.setOffline(true);await page.reload();await page.locator('#resume-draft').click();await page.locator('#note-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#description').inputValue(),'ملاحظة محفوظة تلقائياً');assert.equal(await page.locator('#block').inputValue(),'7');
 const originalBytes=await page.evaluate(async()=>{const s=await import('./storage.js');const b=(await s.listDrafts())[0].record.original;return btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));});assert.equal(originalBytes,bytes);await context.setOffline(false);
 await page.locator('#description').fill('Latest before closing');await page.locator('#close-note').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await page.locator('#nav-archive').click();await page.locator('.draft-open').click();await page.locator('#note-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#description').inputValue(),'Latest before closing');
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(async()=>{const s=await import('./storage.js');return(await s.listDrafts()).length;}),0);
 // Autosaving an edit never replaces the saved note until Save note is pressed.
 await page.locator('#description').fill('Unsaved revision');await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 assert.equal(await page.evaluate(async()=>{const s=await import('./storage.js');return(await s.listNotes())[0].description;}),'Latest before closing');
 await page.locator('#discard-draft').click();await page.locator('#confirm-no').click();assert.equal(await page.locator('#description').inputValue(),'Unsaved revision');
 await page.locator('#discard-draft').click();await page.locator('#confirm-yes').click();
 await page.locator('.note-open').click();await page.locator('#note-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#description').inputValue(),'Latest before closing');
 // A quota failure cannot report success or silently close away the only live copy.
 await page.evaluate(()=>{window.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('full','QuotaExceededError');return window.put.apply(this,args);};});
 await page.locator('#description').fill('Keep this live edit');await page.locator('#close-note').click();
 await page.locator('.inline-notice').filter({hasText:'Storage is full'}).waitFor();
 assert.equal(await page.locator('#note-dialog').isVisible(),true);assert.equal(await page.locator('#description').inputValue(),'Keep this live edit');
 assert.ok(!(await page.locator('#save-status').textContent()).includes('Draft saved'));
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.put;});await page.locator('#close-note').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await page.locator('#library-tools').click();await page.locator('#backup-button').click();
 await page.locator('.inline-notice').filter({hasText:/Save or discard/}).waitFor();await page.locator('#close-library-tools').click();
 await page.locator('.draft-discard').click();await page.locator('#confirm-yes').click();
 await page.waitForFunction(()=>document.querySelectorAll('.draft-open').length===0);assert.equal(await page.locator('.draft-open').count(),0);assert.equal(await page.locator('.note-open').count(),1);
 // Distinct new photos retain distinct drafts; neither replaces the other.
 await page.locator('#nav-camera').click();
 for(const description of ['Draft one','Draft two']){await page.locator('#photo-input').setInputFiles(photo);await page.locator('#description').fill(description);await page.locator('#close-note').click();await page.locator('#note-dialog').waitFor({state:'hidden'});}
 await page.reload();await page.locator('#nav-archive').click();assert.equal(await page.locator('.draft-open').count(),2);
 assert.deepEqual(errors,[]);console.log('PASS: automatic restart recovery, exact original, close flush, saved-note isolation, discard cancellation, quota failure keeps editor, backup guard, multiple drafts.');
} finally {await browser.close();}
