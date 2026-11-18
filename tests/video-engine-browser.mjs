import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({serviceWorkers:'block'});await page.route('https://**',r=>r.abort());
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:4177');
 const available=await page.evaluate(async()=>{try{window.videoEngine=await import('./video.js');return typeof videoEngine.prepareVideo==='function'&&typeof videoEngine.inspectVideo==='function';}catch{return false;}});
 assert.ok(available,'video preparation and inspection are available');
 const result=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');let tick=0;const draw=()=>{x.fillStyle='#dd9922';x.fillRect(0,0,640,360);x.fillStyle='blue';x.fillRect((tick++*10)%600,20,40,40);};draw();
  const stream=c.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
  recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start(100);const timer=setInterval(draw,40);await new Promise(r=>setTimeout(r,1000));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
  const original=new Blob(chunks,{type:recorder.mimeType});window.syntheticVideo=original;
  const raw=document.createElement('video'),rawURL=URL.createObjectURL(original);const metadata=new Promise((yes,no)=>{raw.onloadedmetadata=yes;raw.onerror=no;});raw.src=rawURL;await metadata;const rawDuration=Number.isFinite(raw.duration)?raw.duration:'Infinity';raw.removeAttribute('src');raw.load();URL.revokeObjectURL(rawURL);
  let activeURLs=0;const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=function(...args){activeURLs++;return create.apply(this,args);};URL.revokeObjectURL=function(...args){activeURLs--;return revoke.apply(this,args);};
  const failures=[];let info,asset;
  try {
   info=await videoEngine.inspectVideo(original);asset=await videoEngine.prepareVideo(original);
   for(const value of [new Blob(['bad'],{type:'video/webm'}),new Blob(['bad'],{type:'video/mp4'}),new Blob(['bad'],{type:'application/pdf'}),new Blob([],{type:'video/mp4'}),new Blob([new Uint8Array(50*1024*1024+1)],{type:'video/mp4'})]){try{await videoEngine.prepareVideo(value);failures.push(false);}catch{failures.push(true);}}
   const bitmap=await createImageBitmap(asset.thumbnail);const thumbnail={width:bitmap.width,height:bitmap.height,size:asset.thumbnail.size,type:asset.thumbnail.type};bitmap.close();
   return {rawDuration,info,asset:{id:asset.id,kind:asset.kind,duration:asset.duration,width:asset.width,height:asset.height,annotations:asset.annotations,crop:asset.crop},sameOriginal:asset.original===original,thumbnail,failures,activeURLs};
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
 });
 assert.equal(result.rawDuration,'Infinity','the fixture exercises MediaRecorder WebM missing duration');assert.deepEqual({width:result.info.width,height:result.info.height},{width:640,height:360});assert.ok(result.info.duration>.5&&result.info.duration<2,'duration comes from the real media timeline');assert.equal(result.asset.kind,'video');assert.ok(result.asset.id);assert.equal(result.asset.duration,result.info.duration);assert.deepEqual(result.asset.annotations,[]);assert.deepEqual(result.asset.crop,{ratio:'original'});assert.ok(result.sameOriginal,'original Blob is retained without re-encoding');assert.ok(result.thumbnail.size>0&&result.thumbnail.size<=512*1024);assert.match(result.thumbnail.type,/^image\//);assert.ok(result.thumbnail.width<=640);assert.ok(result.failures.every(Boolean));assert.equal(result.activeURLs,0,'success and rejection release every object URL');
 console.log('PASS: real recorded WebM Infinity-duration probing, dimensions, thumbnail, original identity, corrupt/type/byte rejection and URL cleanup.');
 await page.evaluate(async()=>{
  const {HoldVideoCapture}=await import('./video-capture.js'),button=document.createElement('button');button.id='engine-shutter';button.textContent='Capture';document.body.prepend(button);
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const context=canvas.getContext('2d');let frame=0;
  const draw=()=>{context.fillStyle=frame++%2?'#aadd33':'#8899bb';context.fillRect(0,0,320,240);};draw();
  const preview=canvas.captureStream(20),audioContext=new AudioContext(),oscillator=audioContext.createOscillator(),audio=audioContext.createMediaStreamDestination();oscillator.connect(audio);oscillator.start();
  const originalGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>audio.stream;
  const state={photos:0,activated:false,status:'idle',errors:[],asset:null,preview};window.recordingTest=state;const timer=setInterval(draw,40);
  state.capture=new HoldVideoCapture(button,{getStream:()=>preview,onPhoto:()=>{state.photos++;state.activated=navigator.userActivation.isActive;},onVideo:async blob=>{state.asset=await videoEngine.prepareVideo(blob);},onState:value=>{state.status=value.status;},onError:error=>state.errors.push(error.message)});
  state.cleanup=async()=>{state.capture.destroy();clearInterval(timer);preview.getTracks().forEach(t=>t.stop());oscillator.stop();await audioContext.close();navigator.mediaDevices.getUserMedia=originalGetUserMedia;button.remove();};
 });
 await page.locator('#engine-shutter').click();
 assert.deepEqual(await page.evaluate(()=>({photos:recordingTest.photos,activated:recordingTest.activated})),{photos:1,activated:true},'a real short click retains native picker user activation');
 await page.locator('#engine-shutter').hover();await page.mouse.down();await page.waitForFunction(()=>recordingTest.status==='recording');await new Promise(r=>setTimeout(r,900));await page.mouse.up();
 await page.waitForFunction(()=>recordingTest.status==='idle');
 const captured=await page.evaluate(async()=>{const {photos,errors,asset,preview}=recordingTest;const value={photos,errors,type:asset?.original.type,width:asset?.width,height:asset?.height,duration:asset?.duration,previewLive:preview.getVideoTracks()[0].readyState==='live'};await recordingTest.cleanup();return value;});
 assert.deepEqual(captured.errors,[]);assert.equal(captured.photos,1,'a held gesture never launches native photo capture');assert.equal(captured.width,320);assert.equal(captured.height,240);assert.ok(captured.duration>.4&&captured.duration<2);assert.ok(captured.previewLive,'recording leaves the owner preview track live');assert.match(captured.type,/^video\/(mp4|webm)/);
 console.log('PASS: real held-shutter recording with synthetic camera/audio, short-click user activation, release-to-decode, long-click suppression and preview ownership.');
}finally{await browser.close();}
