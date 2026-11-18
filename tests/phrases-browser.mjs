import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
const page=await context.newPage();
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');await page.locator('#nav-settings').click();
 await page.locator('#phrase-category').selectOption('housekeeping');await page.locator('#phrase-add').click();await page.locator('#phrase-text').fill('يرجى إزالة المخلفات من الممر');await page.locator('#save-phrase').click();
 const row=page.locator('.managed-phrase').filter({hasText:'يرجى إزالة المخلفات من الممر'});await row.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#phrase-text').fill('إزالة مخلفات البناء من الممر');await page.locator('#save-phrase').click();
 await page.locator('#close-settings').click();await page.reload();await page.locator('#nav-settings').click();await page.locator('#phrase-category').selectOption('housekeeping');assert.match(await page.locator('#phrase-list').textContent(),/إزالة مخلفات البناء/);await page.locator('#close-settings').click();
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;return c.toDataURL().split(',')[1];});
 await page.locator('#photo-input').setInputFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.locator('#description').fill('الطابق الأرضي');await page.locator('#category').selectOption('housekeeping');
 await page.locator('#quick-phrases').click();await page.getByRole('button',{name:'إزالة مخلفات البناء من الممر',exact:true}).click();assert.equal(await page.locator('#description').inputValue(),'الطابق الأرضي\nإزالة مخلفات البناء من الممر');
 await page.locator('#category').selectOption('safety');await page.locator('#quick-phrases').click();assert.equal(await page.locator('.phrase-choice').count(),3);assert.ok(!(await page.locator('#phrase-choices').textContent()).includes('إزالة'));await page.locator('#close-phrase-picker').click();
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();await page.locator('#close-note').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await page.locator('#nav-settings').click();await page.locator('#phrase-category').selectOption('housekeeping');await page.locator('.managed-phrase').filter({hasText:'إزالة مخلفات البناء من الممر'}).getByRole('button',{name:/Delete phrase/}).click();await page.locator('#confirm-no').click();assert.match(await page.locator('#phrase-list').textContent(),/إزالة مخلفات البناء/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#settings-backup').click();const download=await downloadPromise,backup=await download.path();
 const fresh=await browser.newContext({serviceWorkers:'block'}),restored=await fresh.newPage();await restored.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');await restored.locator('#restore-input').setInputFiles(backup);await Promise.all([restored.waitForEvent('load'),restored.locator('#confirm-yes').click()]);
 await restored.locator('#nav-settings').click();await restored.locator('#phrase-category').selectOption('housekeeping');assert.match(await restored.locator('#phrase-list').textContent(),/إزالة مخلفات البناء/);
 await page.locator('.managed-phrase').filter({hasText:'إزالة مخلفات البناء من الممر'}).getByRole('button',{name:/Delete phrase/}).click();await page.locator('#confirm-yes').click();assert.ok(!(await page.locator('#phrase-list').textContent()).includes('إزالة مخلفات البناء'));
 const note=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return(await listNotes())[0].description;});assert.match(note,/إزالة مخلفات البناء/);await fresh.close();
 console.log('PASS: category-specific phrases, Arabic CRUD, append preserves existing note, reload/full backup restore, delete cancellation and saved text unchanged.');
}finally{await browser.close();}
