import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectLocation,parseCoordinates} from '../dist/location.js';
import {decodeBackup,encodeBackup,mapsURL,shareableMapsURL} from '../dist/model.js';

const position=(accuracy,latitude=29.333,timestamp=Date.now())=>({coords:{latitude,longitude:48.083,accuracy},timestamp});
function gpsFixture(){
  const cleared=[];
  const gps={getCurrentPosition(callback){gps.first=callback;},watchPosition(callback){gps.next=callback;return 3;},clearWatch:id=>cleared.push(id)};
  return {gps,cleared};
}

test('refines a weak fix, rejects stale fixes, and releases the watch after a precise fix',async()=>{
  const {gps,cleared}=gpsFixture();
  const pending=collectLocation(gps);
  gps.first(position(420));
  gps.next(position(5,29.34,Date.now()-30000));
  assert.deepEqual(cleared,[]);
  gps.next(position(11,29.35));
  assert.equal((await pending).latitude,29.35);
  assert.deepEqual(cleared,[3]);
});

test('uses the most accurate reading at the deadline and suppresses an approximate share link',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {gps,cleared}=gpsFixture();
  const pending=collectLocation(gps);
  gps.first(position(430));gps.next(position(120,29.34));gps.next(position(270,29.35));
  t.mock.timers.tick(8000);
  const best=await pending;
  assert.equal(best.latitude,29.34);
  assert.equal(best.accuracy,120);
  assert.ok(mapsURL(best));
  assert.equal(shareableMapsURL(best),'');
  assert.equal(shareableMapsURL({...best,pinSource:'confirmed'}),mapsURL(best));
  assert.deepEqual(cleared,[3]);
});

test('stops collecting immediately when the note is closed or the pin is edited',async()=>{
  const {gps,cleared}=gpsFixture(),controller=new AbortController();
  const pending=collectLocation(gps,{signal:controller.signal});
  gps.first(position(500));controller.abort();gps.next(position(8));
  await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(cleared,[3]);
});

test('manual pins and protected address fields survive a backup',async()=>{
  const coordinates=parseCoordinates('29.333، 48.083');
  assert.throws(()=>parseCoordinates('91, 48.083'),/latitude/);
  const image=new Blob(['sample'],{type:'image/jpeg'}),now=new Date().toISOString();
  const location={...coordinates,accuracy:0,timestamp:now,pinSource:'manual'};
  const [restored]=await decodeBackup(await encodeBackup([{id:'pin',createdAt:now,description:'',project:'',location,
    address:{area:'',block:'4',street:''},manualAddressFields:['block'],original:image,thumbnail:image,annotations:[]}]));
  assert.deepEqual(restored.location,location);
  assert.deepEqual(restored.manualAddressFields,['block']);
});
