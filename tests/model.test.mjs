import test from 'node:test';
import assert from 'node:assert/strict';
import { mapsURL, shareText, validateRecord, encodeBackup, decodeBackup } from '../dist/model.js';

const sample = () => ({
  id: 'note-1', createdAt: '2026-11-17T09:00:00.000Z', project: 'مشروع السالمية',
  description: 'شرخ بجانب النافذة', address: {area: 'السالمية', block: '5', street: '10'},
  location: {latitude: 29.333, longitude: 48.083, accuracy: 12, timestamp: '2026-11-17T09:00:00.000Z'},
  original: new Blob([new Uint8Array([255,216,255,217])], {type:'image/jpeg'}),
  thumbnail: new Blob([new Uint8Array([255,216,255,217])], {type:'image/jpeg'}),
  annotations: [{type:'arrow',x:0.1,y:0.2,x2:0.8,y2:0.7,color:'#ff5b55'}]
});

test('maps link preserves zero coordinates and rejects invalid coordinates', () => {
  assert.equal(mapsURL({latitude:0,longitude:0}), 'https://maps.google.com/?q=0%2C0');
  assert.equal(mapsURL(null), '');
  assert.equal(mapsURL({latitude:91,longitude:48}), '');
  assert.equal(mapsURL({latitude:'29',longitude:48}), '');
});
test('share text includes editable Kuwait address, description and coordinate link', () => {
  const text=shareText(sample());
  for(const part of ['مشروع السالمية','شرخ بجانب النافذة','Block: 5','Street: 10','q=29.333%2C48.083']) assert.ok(text.includes(part));
  const missing=sample(); missing.location=null;
  assert.ok(!shareText(missing).includes('maps/search'));
});
test('rejects malformed records before any storage operation', () => {
  assert.equal(validateRecord(sample()).id,'note-1');
  for (const mutate of [
    r=>r.original=new Blob(['x'],{type:'text/html'}),
    r=>r.createdAt='bad', r=>r.location.latitude=Infinity,
    r=>r.annotations[0].x=1.5, r=>r.annotations[0].type='script',
    r=>r.annotations[0].color='url(evil)', r=>r.description='a'.repeat(4001),
    r=>r.address=null, r=>r.id='../../other'
  ]) {const r=sample(); mutate(r); assert.throws(()=>validateRecord(r));}
});
test('backup round-trip preserves original bytes, Arabic and annotation vectors', async () => {
  const json=await encodeBackup([sample()]);
  const restored=await decodeBackup(json);
  assert.equal(restored.length,1);
  assert.equal(restored[0].description,'شرخ بجانب النافذة');
  assert.deepEqual([...new Uint8Array(await restored[0].original.arrayBuffer())],[255,216,255,217]);
  assert.deepEqual(restored[0].annotations,sample().annotations);
});
test('resized text survives backup and rejects invalid scale values',async()=>{
 const record=sample();record.annotations=[{type:'text',x:.7,y:.2,color:'#ffffff',text:'معالجة',scale:1.2}];
 assert.deepEqual((await decodeBackup(await encodeBackup([record])))[0].annotations,record.annotations);
 for(const scale of [0,-1,3.1,Infinity,NaN,'1.2',null])assert.throws(()=>validateRecord({...record,annotations:[{...record.annotations[0],scale}]}));
});
test('backup validation rejects unknown version, duplicate IDs and malformed image encoding', async () => {
  const valid=JSON.parse(await encodeBackup([sample()]));
  await assert.rejects(()=>decodeBackup(JSON.stringify({...valid,version:99})));
  await assert.rejects(()=>decodeBackup(JSON.stringify({...valid,records:[valid.records[0],valid.records[0]]})));
  valid.records[0].photos[0].original.data='not a base64 image!';
  await assert.rejects(()=>decodeBackup(JSON.stringify(valid)));
});
test('restores a multi-megabyte phone photo without a regular-expression stack overflow', async () => {
  const record=sample();
  const bytes=new Uint8Array(4*1024*1024);bytes[0]=255;bytes[bytes.length-1]=217;
  record.original=new Blob([bytes],{type:'image/jpeg'});
  const restored=await decodeBackup(await encodeBackup([record]));
  assert.equal(restored[0].original.size,4*1024*1024);
  const result=new Uint8Array(await restored[0].original.arrayBuffer());
  assert.equal(result[0],255);assert.equal(result[result.length-1],217);
});
