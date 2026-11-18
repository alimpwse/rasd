import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:375,height:667},permissions:['camera','geolocation'],geolocation:{latitude:29.333,longitude:48.083,accuracy:12}});
await context.route('https://photon.komoot.io/**',route=>route.abort());
const page=await context.newPage();
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const b64=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=3024;c.height=4032;const x=c.getContext('2d');x.fillStyle='#b8ad95';x.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
 await page.locator('#native-input').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64')});
 await page.locator('#note-dialog').waitFor();
 assert.equal(await page.locator('[data-editor-view]').count(),2,'Edit and Preview only');
 assert.equal(await page.locator('#tab-details').count(),0,'no separate Details tab');
 assert.equal(await page.locator('#note-form').isVisible(),true,'details visible beside markup');
 assert.equal(await page.locator('#description').isVisible(),true);
 assert.equal(await page.locator('#annotation-tools').isVisible(),true);
 for(const viewport of [{width:375,height:667},{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:1024,height:900}]) {
  await page.setViewportSize(viewport);
  const controls=await page.evaluate(()=>[...document.querySelectorAll('[data-tool],#undo,#save-button,#share-button')].map(el=>{
   const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {name:el.textContent.trim(),top:r.top,bottom:r.bottom,hit:hit?.id || hit?.className,visible:r.top>=0 && r.bottom<=innerHeight && !!hit && el.contains(hit)};
  }));
  if(!controls.every(x=>x.visible))await page.screenshot({path:'test-results/markup-layout-failure.png'});
  assert.ok(controls.every(x=>x.visible),JSON.stringify({viewport,controls}));
  const bounds=await page.locator('#edit-canvas').boundingBox(),stage=await page.locator('.editor-image').boundingBox();
  assert.ok(Math.abs(bounds.width/bounds.height-0.75)<0.01,'photo aspect must remain correct');
  assert.ok(bounds.height<=stage.height && bounds.width<=stage.width,'photo must fit the stage');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.setViewportSize({width:375,height:667});
 await page.screenshot({path:'test-results/markup-visible-375.png',fullPage:true});
 await page.locator('#description').fill('ملاحظة محفوظة أثناء التعديل');await page.locator('#tab-edit').click();await page.setViewportSize({width:390,height:420});await page.locator('#description').fill('ملاحظة أثناء التعديل');
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const focused=await page.locator('#description').boundingBox(),footer=await page.locator('.editor-footer').boundingBox();
 assert.ok(focused.y+focused.height<=footer.y,`Focused note clipped by footer: ${JSON.stringify({focused,footer})}`);
 await page.setViewportSize({width:375,height:667});
 await page.locator('#tab-edit').click();await page.locator('#description').fill('ملاحظة عربية — فحص عزل النافذة');
 await page.locator('#tab-edit').click();
 await page.getByRole('button',{name:'Text',exact:true}).click();await page.locator('#edit-canvas').click();await page.locator('#annotation-text').fill('تحتاج معالجة');await page.locator('#finish-photo-text').click();
 await page.locator('#tab-preview').click();assert.equal(await page.locator('#annotation-tools').isVisible(),false);
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const before=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].annotations.length;});
 await page.locator('#edit-canvas').click();await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const after=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].annotations.length;});assert.equal(after,before);
 await page.locator('#tab-preview').focus();await page.keyboard.press('Home');assert.equal(await page.locator('#tab-edit').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-preview').getAttribute('aria-selected'),'true');
 console.log('PASS: portrait capture keeps all markup tools, Save and Share on screen without scrolling.');
}finally{await browser.close();}
