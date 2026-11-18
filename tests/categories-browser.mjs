import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:375,height:667},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
const getNotes=()=>page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes()).map(({original,thumbnail,...n})=>n);});
try {
 await page.goto(base);await page.locator('#nav-settings').click();await page.locator('#message-category').check();
 assert.equal(await page.locator('#category-add').count(),1,'Settings supports adding categories');
 assert.match(await page.locator('#category-list').textContent(),/Site Cleanliness/);
 await page.locator('#category-add').click();await page.locator('#category-name').fill('Concrete works');await page.locator('#save-category').click();
 const id=await page.locator('#default-category option').evaluateAll(options=>options.find(o=>o.textContent==='Concrete works')?.value);assert.ok(id.startsWith('cat_'));
 await page.locator('#default-category').selectOption(id);await page.locator('#close-settings').click();await page.reload();
 await page.locator('#nav-settings').click();assert.equal(await page.locator('#default-category').inputValue(),id);
 await page.screenshot({path:'test-results/categories-settings-mobile.png'});await page.locator('#close-settings').click();
 const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#b3aea3';x.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
 const upload=async()=>{await page.locator('#native-input').setInputFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});await page.locator('#note-dialog').waitFor();};
 const save=async()=>{await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();};
 await upload();assert.equal(await page.locator('#category').inputValue(),id);await save();
 const first=(await getNotes())[0];assert.equal(first.categoryName,'Concrete works');
 await page.locator('#note-settings').click();await page.locator('#default-category').selectOption('safety');await page.locator('#close-settings').click();
 assert.equal(await page.locator('#category').inputValue(),id,'default change must not reassign current photo');
 await page.locator('#close-note').click();
 // Rename while no note is open, then verify library/search and backup resolve it.
 await page.locator('#nav-settings').click();await page.locator(`[data-edit-category="${id}"]`).click();
 await page.locator('#category-name').fill('ملاحظات خرسانة');await page.locator('#save-category').click();
 await page.locator('#category-add').click();await page.locator('#category-name').fill('SAFETY');await page.locator('#save-category').click();
 assert.match(await page.locator('#category-error').textContent(),/already exists/);await page.locator('#cancel-category').click();
 await page.locator('#close-settings').click();await page.locator('#nav-archive').click();await page.locator('.note-card').waitFor();
 await page.locator('#search').fill('خرسانة');assert.equal(await page.locator('.note-card').count(),1);assert.match(await page.locator('.category-badge').textContent(),/ملاحظات خرسانة/);
 assert.equal((await getNotes())[0].category,id,'renaming keeps existing membership');
 await page.locator('#library-tools').click();const downloadPromise=page.waitForEvent('download');await page.locator('#backup-button').click();const download=await downloadPromise;
 const backupPath='test-results/category-backup.json';await download.saveAs(backupPath);const backup=JSON.parse(await readFile(backupPath,'utf8'));assert.equal(backup.records[0].categoryName,'ملاحظات خرسانة');
 await page.locator('#close-library-tools').click();await page.locator('.note-open').click();await page.locator('#tab-edit').click();assert.equal(await page.locator('#category').inputValue(),id);
 await page.evaluate(()=>{navigator.canShare=()=>true;navigator.share=async data=>{window.caption=data.text;};});await page.locator('#share-button').click();assert.match(await page.evaluate(()=>window.caption),/ملاحظات خرسانة/);
 await page.locator('#note-settings').click();await page.locator(`[data-edit-category="${id}"]`).click();await page.locator('#category-name').fill('Concrete inspection');await page.locator('#save-category').click();await page.locator('#close-settings').click();
 assert.match(await page.locator('#save-status').textContent(),/Saving draft|Draft saved/);await save();assert.equal((await getNotes())[0].categoryName,'Concrete inspection');
 await page.locator('#close-note').click();await page.locator('#nav-camera').click();await upload();assert.equal(await page.locator('#category').inputValue(),'safety');await save();
 assert.equal((await getNotes()).length,2);await page.locator('#close-note').click();
 await page.locator('#nav-settings').click();await page.locator('#default-category').selectOption('');await page.locator('#close-settings').click();await upload();assert.equal(await page.locator('#category').inputValue(),'');
 const restoredContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),restored=await restoredContext.newPage();
 await restored.goto(base);await restored.locator('#nav-archive').click();await restored.locator('#library-tools').click();await restored.locator('#restore-input').setInputFiles(backupPath);
 await Promise.all([restored.waitForEvent('load'),restored.locator('#confirm-yes').click()]);await restored.locator('#nav-archive').click();
 await restored.locator('#library-filters summary').click();
 await restored.locator('#notes-category').selectOption(id);await restored.locator('.note-card').waitFor();assert.match(await restored.locator('.category-badge').textContent(),/ملاحظات خرسانة/);
 await restored.locator('#nav-settings').click();assert.equal(await restored.locator('#default-category').inputValue(),'safety','full restore recovers the default category');
 await restored.locator('#close-settings').click();
 // Older note-only files still merge and keep the restored global defaults.
 await restored.locator('#restore-input').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,version:1,kind:undefined,state:undefined,records:backup.records.map(({photos,...record})=>({...record,...photos[0],id:record.id}))}))});
 await restored.getByText('Added 0 notes. Existing notes were kept.',{exact:true}).first().waitFor();
 await restored.locator('#nav-settings').click();assert.equal(await restored.locator('#default-category').inputValue(),'safety');
 await restoredContext.close();assert.deepEqual(errors,[]);
 console.log('PASS: create/rename Arabic-English categories, reject duplicates, persist default for new photos only, stable existing membership, labels in search/share/backup, fresh-device restore and uncategorized default.');
} catch(error){console.error('Page errors:',errors);await page.screenshot({path:'test-results/categories-failure.png'}).catch(()=>{});throw error;}
finally {await browser.close();}
