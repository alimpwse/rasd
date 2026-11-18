import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:375,height:667},permissions:['camera','geolocation'],geolocation:{latitude:29.333,longitude:48.083,accuracy:12},serviceWorkers:'block'});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(12000);
let held,release;let hold=true,fail=false;
const response={type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[48.083,29.333]},properties:{countrycode:'KW',district:'Salmiya',locality:'Salmiya - Block 6',street:'Al-Khansa Street'}}]};
await context.route('https://photon.komoot.io/**',async route=>{
 assert.equal(route.request().method(),'GET');assert.equal(route.request().postData(),null);
 if(hold){held=true;await new Promise(resolve=>{release=resolve;});}
 await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(response)});
});
async function notes(){return page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes()).map(({original,thumbnail,...n})=>n);});}
async function saved(){await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();}
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 assert.equal(await page.locator('#nav-settings').count(),1,'Settings entry must exist');
 await page.locator('#nav-settings').click();await page.locator('#message-category').check();
 await page.locator('#stamp-mode').selectOption('overlay');await page.locator('#stamp-time').uncheck();await page.locator('#share-include-text').uncheck();
 await page.locator('#close-settings').click();await page.reload();await page.locator('#nav-settings').click();
 assert.equal(await page.locator('#stamp-mode').inputValue(),'overlay');assert.equal(await page.locator('#share-include-text').isChecked(),false);
 await page.screenshot({path:'test-results/settings-mobile.png'});await page.locator('#close-settings').click();
 const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=1600;const x=c.getContext('2d');x.fillStyle='#b8ad95';x.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
 const file={name:'site.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')};
 await page.locator('#native-input').setInputFiles(file);await page.locator('#note-dialog').waitFor();await page.locator('#tab-edit').click();
 await page.waitForFunction(()=>document.querySelector('#address-status').textContent.includes('Looking'));
 await page.locator('#street').fill('شارع عدلته يدوياً');assert.ok(held);hold=false;release();
 await page.waitForFunction(()=>document.querySelector('#area').value==='Salmiya');
 assert.equal(await page.locator('#block').inputValue(),'6');assert.equal(await page.locator('#street').inputValue(),'شارع عدلته يدوياً');
 await page.locator('#category').selectOption('safety');await page.locator('#description').fill('فحص سلامة الموقع');await saved();
 const first=(await notes())[0];assert.equal(first.category,'safety');assert.equal(first.stamp.mode,'overlay');assert.equal(first.stamp.time,false);assert.equal(first.export.includeText,false);
 await page.evaluate(()=>{navigator.canShare=()=>true;navigator.share=async data=>{window.sharedPayload={text:data.text,fileType:data.files[0].type,active:navigator.userActivation.isActive};};});
 await page.locator('#share-button').click();assert.deepEqual(await page.evaluate(()=>window.sharedPayload),{text:undefined,fileType:'image/png',active:true});
 await page.screenshot({path:'test-results/address-category-mobile.png'});
 await page.locator('#note-settings').click();await page.locator('#stamp-mode').selectOption('strip');await page.locator('#share-include-text').check();
 await page.locator('#close-settings').click();await saved();assert.equal((await notes())[0].stamp.mode,'overlay','changing defaults must not alter current photo');
 await page.locator('#close-note').click();await page.locator('#native-input').setInputFiles(file);await page.locator('#note-dialog').waitFor();await page.locator('#tab-edit').click();
 await page.locator('#category').selectOption('housekeeping');await page.locator('#description').fill('تنظيف الموقع');await saved();
 const second=(await notes()).find(n=>n.id!==first.id);assert.equal(second.stamp.mode,'strip');assert.equal(second.export.includeText,true);
 await page.locator('#share-button').click();assert.match((await page.evaluate(()=>window.sharedPayload)).text,/Category: Site Cleanliness/);
 await page.locator('#note-settings').click();await page.locator('#stamp-date').uncheck();await page.locator('#apply-photo-settings').click();await page.locator('#close-settings').click();await saved();
 assert.equal((await notes()).find(n=>n.id===second.id).stamp.date,false);
 await page.locator('#close-note').click();await page.locator('#nav-archive').click();await page.locator('.note-card').first().waitFor();
 await page.locator('#library-filters summary').click();
 await page.locator('#notes-category').selectOption('safety');assert.equal(await page.locator('.note-card').count(),1);assert.match(await page.locator('.note-card').textContent(),/Safety/);
 await page.locator('#notes-category').selectOption('housekeeping');assert.equal(await page.locator('.note-card').count(),1);
 await page.locator('#clear-filters').evaluate(el=>el.click());assert.equal(await page.locator('.note-card').count(),2);
 await page.screenshot({path:'test-results/category-library-mobile.png'});
 // Explicitly disabling address lookup prevents a new outbound request.
 await page.locator('#nav-settings').click();await page.locator('#auto-address').uncheck();await page.locator('#close-settings').click();
 let lookups=0;page.on('request',r=>{if(r.url().startsWith('https://photon.komoot.io'))lookups++;});
 await page.locator('#nav-camera').click();await context.setGeolocation({latitude:29.334,longitude:48.083,accuracy:12});
 await page.locator('#native-input').setInputFiles(file);await page.locator('#tab-edit').click();
 await page.waitForFunction(()=>document.querySelector('#location-status').textContent.includes('accuracy'));
 assert.equal(lookups,0);assert.equal(await page.locator('#area').inputValue(),'');
 // A failed provider keeps GPS and allows manual addressing and saving.
 fail=true;await page.locator('#note-settings').click();await page.locator('#auto-address').check();await page.locator('#close-settings').click();
 await page.waitForFunction(()=>document.querySelector('#address-status').textContent.includes('unavailable'));
 await page.locator('#area').fill('منطقة يدوية');await saved();assert.equal((await notes())[0].address.area,'منطقة يدوية');assert.ok((await notes())[0].location);
 assert.deepEqual(errors,[]);console.log('PASS: settings persist for new photos only, share respects include-text default with user activation, categories filter, GPS suggests editable addresses, manual edits survive late lookup, disabled/error fallback remains usable.');
} catch(error) {console.error('Browser errors:',errors,'Address:',await page.locator('#address-status').textContent().catch(()=>''));await page.screenshot({path:'test-results/settings-failure.png'}).catch(()=>{});throw error;}
finally {release?.();await browser.close();}
