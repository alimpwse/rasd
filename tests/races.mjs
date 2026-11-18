import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
await context.route('https://photon.komoot.io/**',route=>route.abort());
const page=await context.newPage();
const failures=[];
try {
  await page.addInitScript(()=>{
    navigator.geolocation.getCurrentPosition=success=>{window.deliverGPS=success;};
  });
  const photoBase64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4032;c.height=3024;const x=c.getContext('2d');x.fillStyle='#d3cfc2';x.fillRect(0,0,c.width,c.height);x.fillStyle='#737f82';x.fillRect(600,400,2300,1800);x.strokeStyle='#20282b';x.lineWidth=12;x.beginPath();x.moveTo(1500,1200);x.lineTo(1680,1400);x.lineTo(1550,1900);x.stroke();return c.toDataURL('image/png').split(',')[1];});
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
  await page.evaluate(()=>{
    const original=window.createImageBitmap;
    window.createImageBitmap=async(...args)=>{
      window.decodePending=true;
      await new Promise(resolve=>{window.releaseDecode=resolve;});
      window.createImageBitmap=original;
      return original(...args);
    };
  });
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Take photo',exact:true}).click();
  const chooser=await chooserPromise;
  await chooser.setFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(photoBase64,'base64')});
  await page.waitForFunction(()=>window.decodePending);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(()=>window.releaseDecode());
  await page.getByRole('dialog',{name:'Edit note'}).waitFor();
  try {assert.equal(await page.evaluate(()=>document.getElementById('camera-video').srcObject===null),true,'camera must remain stopped behind editor');}
  catch(error){failures.push(error.message);}
  await page.locator('#tab-edit').click();
  await page.getByLabel('Site note').fill('ملاحظة مع موقع متأخر');
  await page.evaluate(()=>{
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')this.transaction.savingNote=true;return originalPut.apply(this,args);};
    const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{
      configurable:true,get:descriptor.get,
      set(callback){
        descriptor.set.call(this,function(event){
          if(this.savingNote && window.deliverGPS){
            const success=window.deliverGPS;window.deliverGPS=null;
            success({coords:{latitude:29.333,longitude:48.083,accuracy:12},timestamp:Date.now()});
          }
          callback.call(this,event);
        });
      }
    });
  });
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.waitForFunction(()=>window.deliverGPS===null);
  try {assert.ok((await page.locator('#save-status').textContent()).includes('Location updated'),'late GPS must keep pending changes visible');}
  catch(error){failures.push(error.message);}
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.getByText('Saved on this device.',{exact:true}).waitFor();
  const location=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].location;});
  try {assert.equal(location?.latitude,29.333,'late GPS must survive a second save');}
  catch(error){failures.push(error.message);}
  assert.deepEqual(failures,[]);
  console.log('PASS: delayed image decode cannot resume hidden camera; GPS arriving during save remains unsaved and is preserved on next save.');
}finally{await browser.close();}
