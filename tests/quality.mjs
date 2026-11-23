import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:375,height:812},permissions:['camera','geolocation'],geolocation:{latitude:29.333,longitude:48.083,accuracy:8}});
await context.route('https://photon.komoot.io/**',route=>route.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const result=await page.evaluate(async()=>{
  const {PhotoEditor}=await import('./editor.js');
  const src=document.createElement('canvas');src.width=4032;src.height=3024;
  const ctx=src.getContext('2d');ctx.fillStyle='rgb(100,120,140)';ctx.fillRect(0,0,src.width,src.height);
  const original=await new Promise(r=>src.toBlob(r,'image/png'));
  window.fixture=original;
  const editor=new PhotoEditor(document.createElement('canvas'),()=>{},()=>{});await editor.load(original);
  const base={createdAt:'2026-11-17T09:00:00Z',project:'Project A',description:'ملاحظة عربية مع A-12',address:{area:'السالمية',block:'5',street:'10'},location:{latitude:29.333,longitude:48.083},stamp:{mode:'off',date:true,time:true,location:true,note:true,project:true}};
  const inspect=async(blob)=>{
   const img=await createImageBitmap(blob),c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(img,0,0);const pixel=[...x.getImageData(0,0,1,1).data];const size={width:img.width,height:img.height,type:blob.type,pixel,bytes:blob.size};img.close();return size;
  };
  editor.setRecord(base);const plain=await inspect(await editor.export());
  editor.setRecord({...base,stamp:{...base.stamp,mode:'strip'}});const strip=await inspect(await editor.export());
  editor.setRecord({...base,stamp:{...base.stamp,mode:'overlay'}});const overlay=await inspect(await editor.export());
  editor.setRecord(base);
  const pixels=ctx.createImageData(src.width,src.height);
  let seed=123;
  for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed>>>24;pixels.data[i+1]=(seed>>>16)&255;pixels.data[i+2]=(seed>>>8)&255;pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);
  const textured=await new Promise(r=>src.toBlob(r,'image/png'));src.width=src.height=1;
  await editor.load(textured,[],{renderPreview:false});
  editor.setRecord(base,{renderPreview:false});
  const compact=await inspect(await editor.export());
  let overlong=false;try{editor.setRecord({...base,description:'long note '.repeat(400),stamp:{...base.stamp,mode:'overlay'}});}catch{overlong=true;}
  editor.render();const thumb=await editor.export(320,.8);editor.clear();
  return {plain,strip,overlay,compact,pngBytes:textured.size,overlong,thumbnailSize:thumb.size};
 });
 assert.equal(result.plain.width,4032);assert.equal(result.plain.height,3024);assert.equal(result.plain.type,'image/jpeg');
 assert.equal(result.compact.width,4032);assert.equal(result.compact.height,3024);assert.ok(result.compact.bytes<result.pngBytes/2);
 console.log('Textured 12 MP fixture: PNG',result.pngBytes,'bytes, JPEG',result.compact.bytes,'bytes');
 assert.equal(result.strip.width,4032);assert.ok(result.strip.height>3024);assert.ok(result.strip.pixel.every((value,i)=>Math.abs(value-[100,120,140,255][i])<=3));
 assert.equal(result.overlay.width,4032);assert.equal(result.overlay.height,3024);assert.ok(result.overlong);assert.ok(result.thumbnailSize>0);
 const input=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.fixture.arrayBuffer()))));
 await page.locator('#add-project').click();await page.locator('#project-name').fill('مشروع A');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await page.reload();assert.equal(await page.locator('#active-project').inputValue(),'مشروع A');
 const upload=async()=>{
  const waiting=page.waitForEvent('filechooser');await page.locator('#shutter').click();
  const chooser=await waiting;
  // Chromium timestamps a synthetic fix when setGeolocation is called.
  await context.setGeolocation({latitude:29.333,longitude:48.083,accuracy:8});
  await chooser.setFiles({name:'original.png',mimeType:'image/png',buffer:input});
  await page.locator('#note-dialog').waitFor();
 };
 await upload();assert.equal(await page.locator('#project').inputValue(),'مشروع A');
 await page.locator('#tab-edit').click();await page.locator('#description').fill('معالجة فاصل التمدد — A-12');await page.locator('#area').fill('السالمية');await page.locator('#block').fill('5');
 await page.waitForFunction(()=>document.querySelector('#location-status').classList.contains('has-location'));
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 const record=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');const r=(await listNotes())[0];return {bytes:Array.from(new Uint8Array(await r.original.arrayBuffer())),stamp:r.stamp};});
 assert.deepEqual(Buffer.from(record.bytes),input);assert.equal(record.stamp.mode,'strip');
 await page.locator('#note-settings').click();await page.locator('#stamp-mode').selectOption('overlay');await page.locator('#stamp-time').uncheck();await page.locator('#apply-photo-settings').click();await page.locator('#close-settings').click();await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 await page.locator('#close-note').click();await page.locator('#nav-archive').click();await page.locator('.note-card').click();
 const restored=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes())[0].stamp;});assert.equal(restored.mode,'overlay');assert.equal(restored.time,false);
 await page.locator('#note-settings').click();await page.locator('#stamp-mode').selectOption('strip');await page.locator('#apply-photo-settings').click();await page.locator('#close-settings').click();await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 await page.locator('#tab-preview').click();await page.locator('#edit-canvas').evaluate(el=>el.scrollIntoView({block:'start'}));
 await page.screenshot({path:'test-results/redesign-editor-375.png',fullPage:true});
 for(const viewport of [{width:375,height:812},{width:844,height:390},{width:1024,height:900}]){
  await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('#note-dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  assert.equal(await page.locator('.edit-layout').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 }
 await page.screenshot({path:'test-results/redesign-editor-desktop.png',fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});await page.addStyleTag({content:'html{font-size:24px}'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#close-note').click();await page.locator('#nav-camera').click();await page.setViewportSize({width:375,height:812});
 await page.locator('#add-project').click();await page.locator('#project-name').fill('Site B');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await upload();assert.equal(await page.locator('#project').inputValue(),'Site B');assert.equal(await page.locator('#area').inputValue(),'');assert.equal(await page.locator('#description').inputValue(),'');
 await page.locator('#tab-edit').click();await page.locator('#description').fill('a '.repeat(1500));await page.locator('#note-settings').click();await page.locator('#stamp-note').check();await page.locator('#stamp-mode').selectOption('overlay');await page.locator('#apply-photo-settings').click();await page.locator('#close-settings').click();
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 assert.equal(await page.locator('#share-button').isDisabled(),true);
 await page.locator('#note-settings').click();assert.equal(await page.locator('#download-original').isDisabled(),false);await page.locator('#close-settings').click();
 await page.locator('#close-note').click();await page.reload();assert.equal(await page.locator('#active-project').inputValue(),'Site B');
 assert.deepEqual(errors,[]);
 console.log('PASS: 4032x3024 pixels preserved, compact JPEG strip adds height, overlay retains dimensions, original bytes identical, projects remembered, no reused address, stamp persistence, Arabic, 375px/landscape/tablet layout, oversized overlay can save original.');
} finally {await browser.close();}
