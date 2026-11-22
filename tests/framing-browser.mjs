import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:375,height:667},permissions:['camera','geolocation'],geolocation:{latitude:29.333,longitude:48.083,accuracy:12},serviceWorkers:'block'});
await context.route('https://photon.komoot.io/**',route=>route.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const keys=['project','category','note','date','time','area','block','street','map'];
const saved=async()=>{await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();};
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const result=await page.evaluate(async()=>{
  const {PhotoEditor}=await import('./editor.js'),{cropRect}=await import('./framing.js'),{DEFAULT_STAMP}=await import('./stamp.js');
  const sizes=[];
  for(const [w,h] of [[4032,3024],[3024,4032]]){
   const src=document.createElement('canvas');src.width=w;src.height=h;const x=src.getContext('2d');
   const pixels=x.createImageData(w,h);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=(i/4)%251;pixels.data[i+1]=Math.floor(i/4/w)%253;pixels.data[i+2]=71;pixels.data[i+3]=255;}x.putImageData(pixels,0,0);
   const blob=await new Promise(r=>src.toBlob(r));const e=new PhotoEditor(document.createElement('canvas'),()=>{},()=>{});await e.load(blob);
   const base={createdAt:'2026-11-17T06:05:00Z',project:'Site',description:'Note',address:{},stamp:{...DEFAULT_STAMP,mode:'off'},crop:{ratio:'16:9'}};e.setRecord(base);
   const exported=await createImageBitmap(await e.export(Infinity,0.92,'image/png')),frame=cropRect(w,h,base.crop),dest=document.createElement('canvas');dest.width=exported.width;dest.height=exported.height;const d=dest.getContext('2d');d.drawImage(exported,0,0);
   const expected=x.getImageData(frame.x,frame.y,frame.width,frame.height).data,actual=d.getImageData(0,0,dest.width,dest.height).data;
   let equal=expected.length===actual.length;for(let i=0;equal && i<expected.length;i++)if(expected[i]!==actual[i])equal=false;
   e.setRecord({...base,stamp:{...DEFAULT_STAMP,mode:'strip'}});const strip=await createImageBitmap(await e.export(Infinity,0.92,'image/png'));
   e.setRecord({...base,crop:{ratio:'original'}});const original=await createImageBitmap(await e.export(Infinity,0.92,'image/png'));
   sizes.push({width:exported.width,height:exported.height,equal,stripHeight:strip.height,original:[original.width,original.height]});
   exported.close();strip.close();original.close();e.clear();
  }
  const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;top:0;left:0;width:320px;height:180px';document.body.append(canvas);
  const src=document.createElement('canvas');src.width=160;src.height=120;src.getContext('2d').fillRect(0,0,160,120);
  const e=new PhotoEditor(canvas,()=>{},()=>{});await e.load(await new Promise(r=>src.toBlob(r)));e.setView('markup');e.setRecord({crop:{ratio:'16:9'}});
  const box=canvas.getBoundingClientRect(),top=e.point({clientX:box.left,clientY:box.top}),bottom=e.point({clientX:box.right,clientY:box.bottom});
  e.annotations=[{type:'arrow',x:.25,y:.25,x2:.75,y2:.75,color:'#ff5b55'}];const before=JSON.stringify(e.annotations);e.setRecord({crop:{ratio:'original'}});e.setRecord({crop:{ratio:'16:9'}});const after=JSON.stringify(e.annotations);e.clear();canvas.remove();
  return {sizes,top,bottom,stable:before===after};
 });
 assert.deepEqual(result.sizes.map(r=>[r.width,r.height]),[[4032,2268],[2268,4032]]);assert.ok(result.sizes.every(r=>r.equal && r.stripHeight>r.height));
 assert.deepEqual(result.sizes.map(r=>r.original),[[4032,3024],[3024,4032]]);assert.deepEqual(result.top,{x:0,y:.125});assert.deepEqual(result.bottom,{x:1,y:.875});assert.ok(result.stable);
 await page.evaluate(async()=>{const {DEFAULT_STAMP}=await import('./stamp.js');localStorage.setItem('rasd-settings-v1',JSON.stringify({stamp:DEFAULT_STAMP,export:{includeText:true},autoAddress:false,photoRatio:'16:9'}));});await page.reload();assert.equal(await page.locator('#capture-ratio').count(),0);
 await page.locator('#nav-settings').click();assert.equal(await page.locator('#default-photo-ratio').count(),0);await page.locator('#stamp-mode').selectOption('off');await page.locator('#auto-address').uncheck();
 for(const key of keys)if(key!=='note' && key!=='time')await page.locator(`#message-${key}`).uncheck();
 await page.locator('#close-settings').click();await page.reload();
 const bytes=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=1600;const x=c.getContext('2d');x.fillStyle='#b8ad95';x.fillRect(0,0,1200,1600);return c.toDataURL().split(',')[1];}),'base64');
 await page.locator('#native-input').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:bytes});await page.locator('#note-dialog').waitFor();assert.equal(await page.locator('#photo-ratio').inputValue(),'original','old default must never crop a new capture');
 const uncropped=await page.locator('#edit-canvas').boundingBox();assert.ok(Math.abs(uncropped.width/uncropped.height-.75)<.01);
 await page.locator('#note-settings').click();await page.locator('#photo-ratio').selectOption('16:9');await page.locator('#close-settings').click();
 for(const viewport of [{width:320,height:568},{width:844,height:390},{width:375,height:667}]){
  await page.setViewportSize(viewport);
  const visible=await page.evaluate(()=>[...document.querySelectorAll('[data-tool],#undo,#save-button,#share-button')].every(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0 && r.bottom<=innerHeight && !!hit && el.contains(hit);}));assert.ok(visible,JSON.stringify(viewport));
  const rect=await page.locator('#edit-canvas').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.01);
 }
 await page.screenshot({path:'test-results/framing-mobile.png'});
 await page.locator('#tab-edit').click();await page.locator('#description').fill('ملاحظة للتصدير');await page.locator('#area').fill('Salmiya');await saved();
 const record=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');const r=(await listNotes())[0];return {crop:r.crop,export:r.export,bytes:Array.from(new Uint8Array(await r.original.arrayBuffer())),annotations:r.annotations};});assert.deepEqual(Buffer.from(record.bytes),bytes);assert.equal(record.crop.ratio,'16:9');assert.equal(record.export.fields.map,false);
 await page.evaluate(()=>{navigator.canShare=()=>true;navigator.share=async data=>{window.payload={text:data.text,active:navigator.userActivation.isActive,type:data.files[0].type};};Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text},configurable:true});});
 await page.locator('#share-button').click();const payload=await page.evaluate(()=>window.payload);assert.match(payload.text,/^ملاحظة للتصدير\n\d{1,2}:\d{2} [AP]M$/);assert.equal(payload.active,true);assert.equal(payload.type,'image/jpeg');
 await page.locator('#note-settings').click();assert.equal(await page.locator('#message-preview').textContent(),payload.text);await page.locator('#message-time').uncheck();await page.locator('#message-note').uncheck();
 await page.screenshot({path:'test-results/share-fields-mobile.png'});
 await page.locator('#close-settings').click();await page.locator('#share-button').click();assert.equal((await page.evaluate(()=>window.payload)).text,payload.text,'defaults must not mutate open note');
 await page.locator('#note-settings').click();await page.locator('#apply-photo-settings').click();await page.locator('#copy-text').click();assert.equal(await page.evaluate(()=>window.copied),undefined,'empty selection must not replace clipboard');await page.locator('#close-settings').click();
 await page.locator('#share-button').click();assert.equal((await page.evaluate(()=>window.payload)).text,undefined,'all-off share must omit text entirely');
 await page.locator('#tab-edit').click();await page.locator('#note-settings').click();await page.locator('#photo-ratio').selectOption('original');await page.locator('#close-settings').click();const full=await page.locator('#edit-canvas').boundingBox();assert.ok(Math.abs(full.width/full.height-.75)<.01);await saved();
 await page.locator('#close-note').click();await page.locator('#nav-archive').click();await page.locator('.note-open').first().click();assert.equal(await page.locator('#photo-ratio').inputValue(),'original');await page.locator('#note-settings').click();await page.locator('#photo-ratio').selectOption('16:9');await page.locator('#close-settings').click();await saved();
 await page.locator('#close-note').click();await page.locator('#nav-settings').click();assert.equal(await page.locator('#current-photo-actions').isVisible(),false);await page.locator('#close-settings').click();await page.locator('#nav-camera').click();
 const wide=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;return c.toDataURL().split(',')[1];}),'base64');
 await page.locator('#photo-input').setInputFiles({name:'camera-16-9.png',mimeType:'image/png',buffer:wide});await page.locator('#note-dialog').waitFor();assert.equal(await page.locator('#photo-ratio').inputValue(),'original');
 const wideBounds=await page.locator('#edit-canvas').boundingBox();assert.ok(Math.abs(wideBounds.width/wideBounds.height-16/9)<.01,'a 16:9 camera photo keeps its supplied ratio');await saved();
 const wideRecord=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');const n=(await listNotes())[0];return {crop:n.crop,bytes:Array.from(new Uint8Array(await n.original.arrayBuffer()))};});assert.deepEqual(wideRecord.crop,{ratio:'original'});assert.deepEqual(Buffer.from(wideRecord.bytes),wide);
 assert.deepEqual(errors,[]);console.log('PASS: full-pixel landscape/portrait crop, reversible original, original-coordinate mapping, legacy crop default ignored for capture, optional crop retained, small-screen controls, selected-text sharing with activation, all-off clipboard/share.');
} catch(e){console.error('Page errors:',errors);await page.screenshot({path:'test-results/framing-failure.png'}).catch(()=>{});throw e;}
finally{await browser.close();}
