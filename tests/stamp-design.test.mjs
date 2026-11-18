import test from 'node:test';
import assert from 'node:assert/strict';
import {stampSections,layoutStamp,DEFAULT_STAMP} from '../dist/stamp.js';
import {calendarDate,formatTime} from '../dist/datetime.js';
import {mapsURL} from '../dist/model.js';
const record={createdAt:'2026-11-17T10:05:00Z',project:'Site A',category:'safety',description:'ملاحظة عربية في الموقع',address:{area:'السالمية',block:'5',street:'10'},location:{latitude:29.333,longitude:48.083},stamp:{...DEFAULT_STAMP}};
test('stamp prints a numeric Kuwait date and a 12-hour time without zone labels',()=>{
 assert.equal(calendarDate(record.createdAt),'17/11/2026');assert.equal(formatTime(record.createdAt),'1:05 PM');
 assert.equal(calendarDate('2026-11-16T22:00:00Z'),'17/11/2026');
});
test('coordinates remain available for maps but never become printed photo text',()=>{
 const sections=stampSections(record);assert.match(sections.find(x=>x.label==='LOCATION').text,/السالمية/);
 assert.doesNotMatch(JSON.stringify(sections),/29\.333|48\.083/);
 assert.equal(stampSections({...record,address:{}}).some(x=>x.label==='LOCATION'),false);
 assert.equal(mapsURL(record.location),'https://maps.google.com/?q=29.333%2C48.083');
});
test('information strip lays every text block within both portrait and landscape widths',()=>{
 const ctx={font:'',measureText(text){return {width:[...text].length*parseFloat(this.font.match(/[\d.]+(?=px)/)?.[0]||'16')*.55};}};
 for(const [width,height] of [[4032,3024],[3024,4032],[1600,900],[900,1600]]){
  const layout=layoutStamp(ctx,{...record,description:record.description.repeat(20)},width,height);
  assert.ok(layout.rows?.length,'structured rows allow bounds validation');
  for(const row of layout.rows){assert.ok(row.x>=0);assert.ok(row.x+row.width<=width);assert.ok(row.y+row.height<=layout.height);}
 }
});
