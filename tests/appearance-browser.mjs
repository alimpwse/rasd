import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.locator('#nav-settings').click();assert.equal(await page.locator('#stamp-mode').inputValue(),'strip');
 await page.screenshot({path:'test-results/v08-settings-dark.png'});
 await page.locator('[data-theme-choice=light]').click();await page.locator('#stamp-time').uncheck();await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light','other settings saves retain theme');
 const contrast=await page.evaluate(()=>{
  const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  const ink=luminance(getComputedStyle(document.querySelector('.empty-state')).color),paper=luminance(getComputedStyle(document.querySelector('.app-shell')).backgroundColor);return (Math.max(ink,paper)+.05)/(Math.min(ink,paper)+.05);
 });assert.ok(contrast>=4.5,`Light empty-library instructions need readable contrast: ${contrast}`);
 await page.locator('#nav-settings').click();assert.equal(await page.locator('[data-theme-choice=light]').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'test-results/v08-settings-light.png'});
 for(const size of [{width:320,height:568},{width:844,height:390},{width:1024,height:900}]){
  await page.setViewportSize(size);
  assert.equal(await page.locator('#settings-content').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.locator('#settings-backup').scrollIntoViewIfNeeded();assert.ok(await page.locator('#settings-backup').isVisible());
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#close-settings').click();
 await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Offline ready');
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const result=await page.evaluate(async()=>{
  const {PhotoEditor}=await import('./editor.js'),{DEFAULT_STAMP,stampSections}=await import('./stamp.js'),{ensurePhotoFonts}=await import('./fonts.js');
  await ensurePhotoFonts();
  const fonts=[400,500,600].map(w=>document.fonts.check(`${w} 24px "IBM Plex Sans Arabic"`,'ملاحظة عربية'));
  const text=[],native=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){text.push(args[0]);return native.apply(this,args);};
  const exports=[];
  for(const [width,height] of [[1600,900],[900,1600]]){
   const src=document.createElement('canvas');src.width=width;src.height=height;const c=src.getContext('2d');c.fillStyle='#9b9d91';c.fillRect(0,0,width,height);
   // Exact source pixels on both edges are a regression guard against auto-cropping.
   c.fillStyle='#e23b30';c.fillRect(0,0,4,height);c.fillStyle='#2a80cf';c.fillRect(width-4,0,4,height);
   const original=await new Promise(r=>src.toBlob(r));const editor=new PhotoEditor(document.createElement('canvas'),()=>{},()=>{});await editor.load(original);
   const record={createdAt:'2026-11-17T10:05:00Z',project:'مشروع السالمية',description:'إزالة المخلفات من ممر المشاة وإبقاء المدخل خالياً',category:'housekeeping',address:{area:'السالمية',block:'5',street:'10'},location:{latitude:29.333,longitude:48.083},stamp:{...DEFAULT_STAMP}};
   editor.setRecord(record);const blob=await editor.export(),bitmap=await createImageBitmap(blob);const out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;const x=out.getContext('2d');x.drawImage(bitmap,0,0);
   exports.push({width:bitmap.width,height:bitmap.height,sourceHeight:height,left:[...x.getImageData(0,height-1,1,1).data],right:[...x.getImageData(width-1,height-1,1,1).data],paper:[...x.getImageData(0,height,1,1).data],data:out.toDataURL()});
   const before=await blob.arrayBuffer();document.documentElement.dataset.theme='dark';const after=await(await editor.export()).arrayBuffer();exports.at(-1).sameThemeBytes=before.byteLength===after.byteLength && new Uint8Array(before).every((v,i)=>v===new Uint8Array(after)[i]);bitmap.close();editor.clear();
  }
  CanvasRenderingContext2D.prototype.fillText=native;
  return {fonts,exports,text};
 });
 assert.ok(result.fonts.every(Boolean),'all Arabic font weights are available offline');
 for(const item of result.exports){assert.ok(item.height>item.sourceHeight);assert.deepEqual(item.left,[226,59,48,255]);assert.deepEqual(item.right,[42,128,207,255]);assert.deepEqual(item.paper,[247,247,242,255]);assert.ok(item.sameThemeBytes);}
 assert.ok(result.text.includes('17/11/2026 · 1:05 PM'));assert.ok(result.text.includes('مشروع السالمية'));assert.doesNotMatch(result.text.join(' '),/29\.333|48\.083|KWT/);
 const {writeFile}=await import('node:fs/promises');for(const [i,item] of result.exports.entries())await writeFile(`test-results/v08-strip-${i?'portrait':'landscape'}.png`,Buffer.from(item.data.split(',')[1],'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: default dark/strip, persistent light after settings changes, responsive Settings, offline Plex weights, portrait/landscape full pixel exports, hidden GPS, numeric date, theme-independent export.');
}finally{await browser.close();}
