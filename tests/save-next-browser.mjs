import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
await page.route('https://photon.komoot.io/**',route=>route.abort());
await page.addInitScript(()=>{window.gpsRequests=[];navigator.geolocation.getCurrentPosition=success=>window.gpsRequests.push(success);});
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const bytes=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=600;const x=c.getContext('2d');x.fillStyle='#bcb29c';x.fillRect(0,0,900,600);x.fillStyle='#566b73';x.fillRect(120,60,650,430);return c.toDataURL().split(',')[1];}),'base64');
 const photo={name:'site.png',mimeType:'image/png',buffer:bytes};
 await page.locator('#photo-input').setInputFiles(photo);await page.locator('#note-dialog').waitFor({state:'visible'});
 await page.locator('#add-note-project').click();await page.locator('#project-name').fill('Round project');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await page.locator('#category').selectOption('safety');await page.locator('#description').fill('الحواجز غير مؤمنة');await page.locator('#area').fill('السالمية');await page.locator('#block').fill('5');await page.locator('#street').fill('10');
 await page.locator('#add-photo-library').setInputFiles(photo);await page.waitForFunction(()=>document.querySelectorAll('.photo-thumbnail').length===2);
 await page.screenshot({path:'test-results/save-next-editor.png'});
 for(const viewport of [{width:320,height:568},{width:844,height:390}]){await page.setViewportSize(viewport);for(const id of ['save-button','save-next','share-button']){const b=await page.locator('#'+id).boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width&&b.y+b.height<=viewport.height,`${id} stays on screen at ${viewport.width}px`);}}
 await page.setViewportSize({width:390,height:844});
 // Complete a GPS request during the first commit: Save & Next must commit it before leaving.
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes'){this.transaction.savedRecord=true;window.noteWrites=(window.noteWrites||0)+1;}return put.apply(this,args);};const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get:d.get,set(callback){d.set.call(this,function(event){if(this.savedRecord&&!window.lateGPS){window.lateGPS=true;window.gpsRequests[0]({coords:{latitude:29.333,longitude:48.083,accuracy:12},timestamp:Date.now()});}callback.call(this,event);});}});});
 await page.locator('#save-next').evaluate(button=>{button.click();button.click();});
 await page.locator('#note-dialog').waitFor({state:'hidden',timeout:30000});await page.locator('#next-note-banner').waitFor({state:'visible'});
 const saved=await page.evaluate(async()=>({notes:await (await import('./storage.js')).listNotes(),drafts:await (await import('./storage.js')).listDrafts(),writes:window.noteWrites}));assert.equal(saved.notes.length,1);assert.equal(saved.notes[0].photos.length,2);assert.equal(saved.notes[0].description,'الحواجز غير مؤمنة');assert.equal(saved.notes[0].location.latitude,29.333);assert.equal(saved.drafts.length,0);assert.equal(saved.writes,2,'only one save chain, with one late-GPS follow-up');
 assert.equal(await page.locator('#camera-screen').isVisible(),true);assert.match(await page.locator('#next-note-category').textContent(),/Safety/);await page.screenshot({path:'test-results/save-next-camera.png'});
 await page.locator('#native-input').dispatchEvent('cancel');assert.equal(await page.locator('#next-note-banner').isVisible(),true);assert.equal(await page.locator('#shutter').isEnabled(),true);
 const chooser=page.waitForEvent('filechooser');await page.locator('#shutter').click();await (await chooser).setFiles(photo);await page.locator('#note-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#project').inputValue(),'Round project');assert.equal(await page.locator('#category').inputValue(),'safety');assert.equal(await page.locator('#description').inputValue(),'');assert.equal(await page.locator('#area').inputValue(),'');assert.equal(await page.locator('#block').inputValue(),'');assert.equal(await page.locator('#street').inputValue(),'');assert.equal(await page.locator('.photo-thumbnail').count(),1);assert.equal(await page.evaluate(()=>window.gpsRequests.length),2);assert.equal(await page.locator('#map-link').isVisible(),false);
 await page.locator('#description').fill('Second observation');await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();assert.equal(await page.locator('#note-dialog').isVisible(),true,'ordinary Save stays in the editor');
 await page.locator('#save-next').click();await page.locator('#note-dialog').waitFor({state:'hidden'});await page.locator('#end-round').click();assert.equal(await page.locator('#next-note-banner').isVisible(),false);
 await page.locator('#photo-input').setInputFiles(photo);await page.locator('#note-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#category').inputValue(),'','ending the round restores the configured default');await page.locator('#close-note').click();
 assert.deepEqual(errors,[]);console.log('PASS: durable Save & Next, all photos, late GPS, duplicate taps, pending picker cancellation, inherited project/category, fresh fields/GPS, normal Save, End round and small/landscape footer.');
}finally{await browser.close();}
