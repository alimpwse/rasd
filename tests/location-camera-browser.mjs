import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,permissions:['camera'],serviceWorkers:'block'});
await context.addInitScript(()=>{
  const request=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.cameraRequests=0;
  navigator.mediaDevices.getUserMedia=options=>{
    window.cameraRequests++;
    if(!window.allowCamera)return Promise.reject(new DOMException('Denied','NotAllowedError'));
    return request(options);
  };
  const play=HTMLVideoElement.prototype.play;
  HTMLVideoElement.prototype.play=function(){
    if(this.id==='camera-video' && window.blockPlayback){window.blockPlayback=false;return Promise.reject(new DOMException('Needs a gesture','NotAllowedError'));}
    return play.call(this);
  };
  navigator.geolocation.getCurrentPosition=callback=>{window.firstFix=callback;};
  navigator.geolocation.watchPosition=(callback,error)=>{window.watchFix=callback;window.watchError=error;return 31;};
  navigator.geolocation.clearWatch=id=>{window.clearedWatch=id;};
  navigator.canShare=()=>true;
  navigator.share=async data=>{window.caption=data.text;};
});
await context.route('https://photon.komoot.io/**',route=>{
  const url=new URL(route.request().url());
  return route.fulfill({json:{features:[{geometry:{coordinates:[Number(url.searchParams.get('lon')),Number(url.searchParams.get('lat'))]},properties:{countrycode:'KW',district:'Updated area',locality:'Block 4',street:'Street 18'}}]}});
});
const page=await context.newPage(),touch=await context.newCDPSession(page);
const shutter=page.locator('#shutter');
const fix=(kind,accuracy,latitude)=>page.evaluate(({kind,accuracy,latitude})=>window[kind]({coords:{latitude,longitude:48.083,accuracy},timestamp:Date.now()}),{kind,accuracy,latitude});
try{
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173/');
  await page.getByText(/Camera permission was denied/).waitFor();
  let chooser=page.waitForEvent('filechooser');
  await shutter.tap();
  assert.equal(await (await chooser).element().getAttribute('id'),'native-input');
  await page.locator('#native-input').dispatchEvent('cancel');
  assert.equal(await page.evaluate(()=>window.cameraRequests),1,'a denied preview does not automatically prompt again');

  const box=await shutter.boundingBox();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
  await page.getByText('Release to open phone video',{exact:true}).waitFor();
  chooser=page.waitForEvent('filechooser');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await (await chooser).element().getAttribute('id'),'native-video-input');
  await page.locator('#native-video-input').dispatchEvent('cancel');
  await page.evaluate(()=>{window.allowCamera=true;window.blockPlayback=true;});
  await page.locator('#restart-camera').click();
  await page.getByText(/Camera is connected/).waitFor();
  await page.locator('#restart-camera').click();
  await page.waitForFunction(()=>document.querySelector('#viewfinder').classList.contains('is-live'));
  assert.equal(await page.evaluate(()=>window.cameraRequests),2,'retrying blocked playback reuses the granted camera stream');

  const png=await page.evaluate(()=>{const image=document.createElement('canvas');image.width=600;image.height=800;return image.toDataURL().split(',')[1];});
  await page.locator('#native-input').setInputFiles({name:'field.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.locator('#description').fill('Check barriers');
  await fix('firstFix',430,29.33);
  await page.getByText(/Improving GPS accuracy/).waitFor();
  await fix('watchFix',95,29.34);
  await page.evaluate(()=>window.watchError({code:2}));
  await page.getByText(/Approximate location \(±95 m\)/).waitFor();
  assert.equal(await page.evaluate(()=>window.clearedWatch),31);
  assert.equal(await page.locator('#area').inputValue(),'');
  await page.locator('#save-button').click();
  await page.getByText('Saved on this device.',{exact:true}).waitFor();
  await page.locator('#share-button').click();
  assert.equal(await page.evaluate(()=>window.caption),'Check barriers');
  await page.locator('.gps-details summary').click();
  assert.match(await page.locator('#map-link').getAttribute('href'),/29\.34/);
  await page.locator('#confirm-location').click();
  await page.locator('#confirm-yes').click();
  await page.getByText('Pin confirmed.',{exact:true}).waitFor();
  await page.locator('#share-button').click();
  assert.match(await page.evaluate(()=>window.caption),/maps\.google\.com\/\?q=29\.34/);

  await page.locator('#block').fill('Manual block');
  await page.locator('#save-button').click();
  await page.getByText('Saved on this device.',{exact:true}).waitFor();
  await page.locator('#close-note').click();
  await page.locator('#nav-archive').click();
  await page.locator('.note-open').click();
  await page.locator('.gps-details summary').click();
  await page.locator('#edit-location').click();
  await page.locator('#pin-coordinates').fill('29.36, 48.09');
  await page.locator('#pin-form button[type=submit]').click();
  await page.getByText('Pin set manually.',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#area').value==='Updated area');
  assert.equal(await page.locator('#block').inputValue(),'Manual block');
  await page.locator('#refresh-location').click();
  await fix('firstFix',200,29.37);
  await page.evaluate(()=>window.watchError({code:2}));
  await page.getByText(/The existing pin was kept/).waitFor();
  assert.match(await page.locator('#map-link').getAttribute('href'),/29\.36%2C48\.09/);
  await page.locator('#refresh-location').click();
  await fix('firstFix',210,29.38);
  await fix('watchFix',12,29.39);
  await page.waitForFunction(()=>document.querySelector('#location-status').textContent==='GPS accuracy ±12 m');
  assert.match(await page.locator('#map-link').getAttribute('href'),/29\.39/);
  console.log('PASS: denied preview photo/video chooser, Safari-style playback retry, GPS refinement, saved approximate pin omitted from share, confirmed/manual pin, and protected address after reload.');
}finally{await browser.close();}
