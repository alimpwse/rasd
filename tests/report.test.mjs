import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSummary} from '../dist/report.js';
const record=n=>({photos:Array.from({length:n},(_,i)=>({id:`p${i}`}))});
test('report summary counts every photo including legacy notes',()=>{
 assert.deepEqual(reportSummary([record(3),{original:new Blob(['photo'])}]),{noteCount:2,photoCount:4});
});
test('report summary identifies video previews without dropping mixed attachments',()=>{
 assert.deepEqual(reportSummary([{photos:[{id:'photo'},{id:'clip',kind:'video'}]}]),{noteCount:1,photoCount:2,videoCount:1});
});
test('report selection rejects empty, too many notes and too many photos',()=>{
 assert.throws(()=>reportSummary([]),/select/i);
 assert.throws(()=>reportSummary(Array.from({length:21},()=>record(1))),/20/);
 assert.throws(()=>reportSummary(Array.from({length:6},()=>record(9))),/50/);
 assert.throws(()=>reportSummary([record(0)]),/photo/i);
 assert.deepEqual(reportSummary(Array.from({length:20},()=>record(2))),{noteCount:20,photoCount:40});
});

test('cancellation is reported before decoding or rendering a selected photo',async()=>{
 const {buildReport}=await import('../dist/report.js');
 const controller=new AbortController();controller.abort();
 await assert.rejects(buildReport([record(1)],{signal:controller.signal}),{name:'AbortError'});
});

test('PDF byte budget rejects oversized content before final assembly',async()=>{
 const {ReportPDF}=await import('../dist/pdf.js');
 const pdf=new ReportPDF(),chunk=new Blob([new Uint8Array(1024*1024)]);
 assert.throws(()=>pdf.add(new Blob(Array(100).fill(chunk))),/100 MB/);
});
