import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(18000);
try {
 await page.addInitScript(()=>{
  window.requests=[];navigator.geolocation.getCurrentPosition=fn=>{window.gps=fn;};
  const originalFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>String(url).startsWith('https://photon.komoot.io/')?new Promise(resolve=>{
   // Intentionally ignores AbortSignal to exercise stale-response guards too.
   const parsed=new URL(url),coords=[Number(parsed.searchParams.get('lon')),Number(parsed.searchParams.get('lat'))];
   window.requests.push(area=>resolve(new Response(JSON.stringify({features:[{geometry:{type:'Point',coordinates:coords},properties:{countrycode:'KW',district:area,locality:'Block 9',street:'Street 12'}}]}))));
  }):originalFetch(url,options);
 });
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;return c.toDataURL().split(',')[1];});
 const upload=async()=>{await page.locator('#native-input').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.locator('#note-dialog').waitFor();await page.locator('#tab-edit').click();};
 const gps=async latitude=>page.evaluate(latitude=>window.gps({coords:{latitude,longitude:48.083,accuracy:12},timestamp:Date.now()}),latitude);
 await upload();await gps(29.333);await page.waitForFunction(()=>requests.length===1);
 await page.locator('#discard-draft').click();await page.locator('#confirm-yes').click();await page.locator('#note-dialog').waitFor({state:'hidden'});
 await upload();await gps(29.334);await page.evaluate(()=>requests[0]('Closed note address'));
 await page.waitForFunction(()=>requests.length===2);assert.equal(await page.locator('#area').inputValue(),'');
 await page.locator('#street').fill('Manual street');await page.evaluate(()=>requests[1]('New note address'));
 await page.waitForFunction(()=>document.querySelector('#area').value==='New note address');assert.equal(await page.locator('#street').inputValue(),'Manual street');
 // The third response arrives during the IndexedDB save transaction completion.
 await page.locator('#refresh-location').click();await gps(29.335);await page.waitForFunction(()=>requests.length===3);
 await page.evaluate(()=>{
  const originalPut=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')this.transaction.savingNote=true;return originalPut.apply(this,args);};
  const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
  Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get:descriptor.get,set(callback){
   descriptor.set.call(this,async function(event){
    if(this.savingNote && !window.delivered){window.delivered=true;requests[2]('Arrived during save');await new Promise(resolve=>setTimeout(resolve,30));}
    callback.call(this,event);
   });
  }});
 });
 await page.locator('#save-button').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Location updated'));
 assert.equal(await page.locator('#area').inputValue(),'Arrived during save');await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const saved=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0];});assert.equal(saved.address.area,'Arrived during save');assert.equal(saved.address.street,'Manual street');
 // Turning lookup off must prevent a late response from filling the address.
 await page.locator('#refresh-location').click();await gps(29.336);await page.waitForFunction(()=>requests.length===4);
 await page.locator('#note-settings').click();await page.locator('#auto-address').uncheck();await page.locator('#close-settings').click();
 await page.evaluate(()=>requests[3]('Disabled address'));await page.waitForTimeout(100);
 assert.equal(await page.locator('#area').inputValue(),'');assert.equal(await page.locator('#street').inputValue(),'Manual street');
 assert.match(await page.locator('#address-status').textContent(),/off/);
 console.log('PASS: closed-note and disabled lookups cannot apply stale results; refresh keeps manual fields; address arriving during save remains dirty and persists on next save.');
} finally {await browser.close();}
