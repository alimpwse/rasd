import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(5000);
await page.addInitScript(()=>{indexedDB.open=()=>{throw new DOMException('Persistence denied','SecurityError');};});
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 assert.equal(await page.locator('.app-shell').evaluate(el=>el.inert),false,'storage failure is not evidence of an unfinished restore');
 await page.locator('#nav-settings').click();await page.locator('[data-theme-choice=light]').click();assert.equal(await page.evaluate(()=>localStorage.getItem('rasd-settings-v1')),null,'unverified storage state never receives preference writes');await page.locator('#close-settings').click();
 const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;return c.toDataURL().split(',')[1];});
 await page.locator('#native-input').setInputFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});await page.locator('#note-dialog').waitFor();await page.locator('#description').fill('Capture remains available');
 await page.locator('#save-button').click();await page.locator('.inline-notice').filter({hasText:'Storage unavailable'}).waitFor();
 await page.locator('#note-settings').click();const downloading=page.waitForEvent('download');await page.locator('#download-photo').click();const download=await downloading;assert.match(download.suggestedFilename(),/\.jpg$/);assert.equal(await page.locator('#data-status-dialog').isVisible(),false);
 await page.locator('#close-settings').click();await page.locator('#discard-draft').click();await page.locator('#confirm-yes').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await page.locator('#native-input').setInputFiles({name:'second.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});await page.locator('#note-dialog').waitFor();
 assert.equal(await page.locator('#description').inputValue(),'');
 console.log('PASS: denied IndexedDB blocks persisted changes, retains capture/edit/export and explicit discard permits another photo.');
}finally{await browser.close();}
