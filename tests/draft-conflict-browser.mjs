import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.addInitScript(()=>{navigator.geolocation.getCurrentPosition=()=>{};});
const first=await context.newPage(),second=await context.newPage();
const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
try{
 await first.goto(base);
 const b64=await first.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;return c.toDataURL().split(',')[1];});
 await first.locator('#photo-input').setInputFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});
 await first.locator('#description').fill('Initial draft');await first.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 await second.goto(base);await second.locator('#resume-draft').click();await second.locator('#note-dialog').waitFor({state:'visible'});
 await first.locator('#description').fill('Latest from first window');await first.waitForFunction(()=>document.getElementById('save-status').textContent.includes('Draft saved'));
 await second.locator('#description').fill('Stale second window');await second.locator('#close-note').click();
 await second.locator('.inline-notice').filter({hasText:'another window'}).waitFor();assert.equal(await second.locator('#note-dialog').isVisible(),true);
 await second.locator('#discard-draft').click();await second.locator('#confirm-yes').click();await second.locator('#note-dialog').waitFor({state:'hidden'});
 const remaining=await second.evaluate(async()=>{const {listDrafts}=await import('./storage.js');return(await listDrafts())[0].record.description;});
 assert.equal(remaining,'Latest from first window');
 await second.locator('#resume-draft').click();await second.locator('#note-dialog').waitFor({state:'visible'});
 assert.equal(await second.locator('#description').inputValue(),'Latest from first window');
 console.log('PASS: stale editor cannot overwrite a newer draft; confirmed local discard exits and preserves the latest version.');
}finally{await browser.close();}
