import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
try{
 await page.goto(base);await page.locator('#nav-settings').click();await page.locator('#stamp-address-area').uncheck();await page.locator('#message-area').check();await page.locator('[data-theme-choice=light]').click();
 await page.locator('#stamp-location').uncheck();assert.equal(await page.locator('#stamp-address-block').isEnabled(),false);await page.locator('#stamp-location').check();
 await page.reload();await page.locator('#nav-settings').click();assert.equal(await page.locator('#stamp-address-area').isChecked(),false);assert.equal(await page.locator('#stamp-address-block').isChecked(),true);assert.equal(await page.locator('#stamp-address-street').isChecked(),true);
 await page.screenshot({path:'test-results/v081-address-settings.png'});
 const other=await browser.newContext({serviceWorkers:'block'}),otherPage=await other.newPage();await otherPage.goto(base);await otherPage.locator('#nav-settings').click();assert.equal(await otherPage.locator('#stamp-address-area').isChecked(),false);assert.equal(await otherPage.locator('html').getAttribute('data-theme'),'dark','other device/context keeps independent defaults');await other.close();
 await page.locator('#close-settings').click();const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#d7d4cb';x.fillRect(0,0,c.width,c.height);x.fillStyle='#9a9e9c';x.fillRect(130,70,800,460);x.strokeStyle='#6b7474';x.lineWidth=9;x.strokeRect(240,120,420,240);return c.toDataURL().split(',')[1];});
 await page.locator('#native-input').setInputFiles({name:'site.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});await page.locator('#note-dialog').waitFor();
 await page.locator('#description').fill('إزالة المخلفات من ممر المشاة');await page.locator('#area').fill('Salmiya');await page.locator('#block').fill('5');await page.locator('#street').fill('10');await page.locator('#category').selectOption('safety');await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const result=await page.evaluate(async()=>{
  const {listNotes}=await import('./storage.js'),{stampSections}=await import('./stamp.js'),{PhotoEditor}=await import('./editor.js'),{shareText}=await import('./model.js');const record=(await listNotes())[0];
  const editor=new PhotoEditor(document.createElement('canvas'),()=>{},()=>{});await editor.load(record.original);const exports={};
  for(const mode of ['strip','overlay']){
   editor.setRecord({...record,project:'Salmiya Residence',createdAt:'2026-11-17T09:05:00Z',stamp:{...record.stamp,mode}});const blob=await editor.export(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const x=canvas.getContext('2d');x.drawImage(bitmap,0,0);exports[mode]={width:bitmap.width,height:bitmap.height,data:canvas.toDataURL(),bottom:[...x.getImageData(bitmap.width-2,bitmap.height-2,1,1).data]};bitmap.close();
  }
  editor.clear();return {address:record.address,stamp:record.stamp,printed:stampSections(record).find(x=>x.label==='LOCATION').text,caption:shareText(record),exports};
 });
 assert.equal(result.address.area,'Salmiya');assert.equal(result.printed,'Block 5 · Street 10');assert.match(result.caption,/Area: Salmiya/);assert.equal(result.stamp.address.area,false);
 assert.equal(result.exports.overlay.height,900);assert.equal(result.exports.overlay.width,1600);assert.ok(result.exports.overlay.bottom[0]>=58,'bottom stays visibly lighter than previous 94% black');
 for(const [mode,item] of Object.entries(result.exports))await writeFile(`test-results/v081-${mode}.png`,Buffer.from(item.data.split(',')[1],'base64'));
 await page.locator('#note-settings').click();await page.locator('#stamp-address-area').check();await page.locator('#close-settings').click();await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].stamp.address.area;}),false,'default changes do not silently alter existing photos');
 await page.locator('#note-settings').click();await page.locator('#apply-photo-settings').click();await page.locator('#close-settings').click();await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].stamp.address.area;}),true);
 assert.deepEqual(errors,[]);console.log('PASS: printed address controls persist, retain full saved address/message, stay local to browser/device, copy to new photos only and apply explicitly to existing photos; overlay retains dimensions with lighter fade.');
}finally{await browser.close();}
