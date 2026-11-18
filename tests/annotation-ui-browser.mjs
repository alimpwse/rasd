import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
const page=await context.newPage();
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const bytes=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const x=c.getContext('2d');x.fillStyle='#8c999b';x.fillRect(0,0,1200,900);return c.toDataURL().split(',')[1];});
 await page.locator('#photo-input').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});
 await page.getByRole('button',{name:'Text',exact:true}).click();
 const canvas=page.locator('#edit-canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await canvas.click({position:{x:box.width*.65,y:box.height*.4}});await page.locator('#annotation-text').fill('فحص');await page.locator('#finish-photo-text').click();
 const handle=await canvas.evaluate(c=>{const r=c.getBoundingClientRect(),ctx=c.getContext('2d');ctx.font='600 45px IBM Plex Sans Arabic';return {x:r.x+(.65-ctx.measureText('فحص').width/c.width)*r.width,y:r.y+.45*r.height};});
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x-16,handle.y+8);await page.mouse.up();
 await page.getByRole('button',{name:'Amber',exact:true}).click();
 await canvas.click({position:{x:box.width*.65,y:box.height*.4}});
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 await page.locator('#annotation-text').fill('تحتاج معالجة');
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 assert.equal(await page.evaluate(async()=>{const {listDrafts}=await import('./storage.js');return(await listDrafts())[0].record.annotations[0].text;}),'تحتاج معالجة');
 await page.screenshot({path:'test-results/annotation-selection-mobile.png',fullPage:true});
 // An autosave while holding a drag must persist only the committed position.
 await page.locator('#finish-photo-text').click();await page.locator('#description').fill('Pending drag');await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();
 await page.mouse.move(r.x+r.width*.65,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.8,r.y+r.height*.5);
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 await canvas.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
 assert.equal(await page.evaluate(async()=>{const {listDrafts}=await import('./storage.js');return(await listDrafts())[0].record.annotations[0].x;}),.65);
 // Resume while the text field was still focused: onchange must not be required.
 await page.reload();await page.locator('#resume-draft').click();await page.locator('#note-dialog').waitFor({state:'visible'});
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const stored=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');const {encodeBackup,decodeBackup}=await import('./model.js');const notes=await listNotes();return(await decodeBackup(await encodeBackup(notes)))[0].annotations;});
 assert.equal(stored[0].text,'تحتاج معالجة');assert.equal(stored[0].color,'#ffc44a');assert.ok(stored[0].scale>1 && stored[0].scale<=3);
 console.log('PASS: contextual selection controls, focused Arabic text autosave, resize/color persistence and backup round trip.');
}finally{await browser.close();}
