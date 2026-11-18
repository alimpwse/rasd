import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const results=[];
try{
 for(const timing of ['picker','decode']){
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});await context.addInitScript(()=>{window.gpsCalls=0;navigator.geolocation.getCurrentPosition=()=>window.gpsCalls++;});
  const page=await context.newPage();await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
  const bytes=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=300;return c.toDataURL().split(',')[1];}),'base64'),photo={name:'site.png',mimeType:'image/png',buffer:bytes};
  await page.locator('#photo-input').setInputFiles(photo);await page.locator('#description').fill('Already saved');await page.locator('#save-next').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
  if(timing==='decode')await page.evaluate(()=>{const original=window.createImageBitmap;window.createImageBitmap=async(...args)=>{window.decodeWaiting=true;await new Promise(resolve=>window.releaseDecode=resolve);window.createImageBitmap=original;return original(...args);};});
  const chooser=page.waitForEvent('filechooser');await page.locator('#shutter').click();const picker=await chooser;
  const restore=()=>page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'rasd-restore-revision',newValue:'restored-elsewhere'})));
  if(timing==='picker'){await restore();await picker.setFiles(photo);}else{await picker.setFiles(photo);await page.waitForFunction(()=>window.decodeWaiting);await restore();await page.evaluate(()=>window.releaseDecode());}
  if(timing==='decode')await page.waitForFunction(()=>!document.querySelector('#shutter').disabled);await page.waitForTimeout(200);
  results.push(await page.evaluate(async timing=>{const s=await import('./storage.js');return {timing,gate:document.querySelector('#data-status-dialog').open,editor:document.querySelector('#note-dialog').open,notes:(await s.listNotes()).length,drafts:(await s.listDrafts()).length,gps:window.gpsCalls};},timing));
  await context.close();
 }
 assert.deepEqual(results,[{timing:'picker',gate:true,editor:false,notes:1,drafts:0,gps:1},{timing:'decode',gate:true,editor:false,notes:1,drafts:0,gps:1}]);
 console.log('PASS: restore during the next picker or decode cannot open a stale editor, create a draft or request GPS above the reload gate.');
}finally{await browser.close();}
