import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await (process.env.TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:true});
const page=await browser.newPage({serviceWorkers:'block'});
page.setDefaultTimeout(30000);
await page.route('https://**',route=>route.abort());
await mkdir('test-results',{recursive:true});
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 const ready=await page.evaluate(async()=>{try {window.reportEngine=await import('./report.js');return typeof window.reportEngine.buildReport==='function';}catch{return false;}});
 assert.ok(ready,'a selected-note report builder is available');
 const result=await page.evaluate(async()=>{
  const {buildReport}=window.reportEngine;
  const {DEFAULT_STAMP}=await import('./stamp.js');
  const makePhoto=async(id,w,h,color,crop='original',annotations=[])=>{
   const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);x.fillStyle='#348fd1';x.fillRect(0,0,100,100);
   const original=await new Promise(resolve=>c.toBlob(resolve));c.width=c.height=1;
   return {id,original,thumbnail:original,annotations,crop:{ratio:crop}};
  };
  const photos=[await makePhoto('landscape',1600,1200,'#cabda7','16:9',[{type:'arrow',x:.2,y:.3,x2:.7,y2:.7,color:'#ff5b55'}]),await makePhoto('portrait',900,1600,'#a6bdc2','original',[{type:'text',x:.8,y:.2,text:'فحص الموقع',color:'#ffc44a'}])];
  const base={id:'brief',createdAt:'2026-11-18T06:05:00Z',project:'مشروع المبنى الجديد / Building A',category:'safety',categoryName:'Safety',address:{area:'السالمية',block:'10',street:'شارع الخليج'},location:{latitude:29.333,longitude:48.083,accuracy:10,timestamp:'2026-11-18T06:05:00Z'},description:'يرجى معالجة الملاحظة الموجودة في الموقع والتأكد من سلامة المنطقة قبل استكمال الأعمال.\nInspect the marked area before work continues.',photos,stamp:{...DEFAULT_STAMP,mode:'strip'}};
  const long={...base,id:'long',createdAt:'2026-11-19T06:05:00Z',description:('هذه ملاحظة تفصيلية باللغة العربية يجب الحفاظ على كل كلماتها دون حذف. '.repeat(45))+'\n'+('LONGIDENTIFIER'.repeat(25))+' END_OF_NOTE',photos:[await makePhoto('long-photo',800,600,'#d2cbc0')]};
  window.reportRecords=[long,base];const before=JSON.stringify(window.reportRecords),progress=[],drawn=[];
  const originalFill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push(String(text));return originalFill.call(this,text,...args);};
  let report;
  try {report=await buildReport(window.reportRecords,{onProgress:value=>progress.push(value)});}finally{CanvasRenderingContext2D.prototype.fillText=originalFill;}
  window.reportResult=report;
  const a=document.createElement('a');a.href=URL.createObjectURL(report.blob);a.download='report-engine.pdf';a.id='report-test-download';a.textContent='Download';document.body.append(a);
  return {longDescription:long.description,briefDescription:base.description,pageCount:report.pageCount,noteCount:report.noteCount,photoCount:report.photoCount,type:report.blob.type,previews:report.previews.map(p=>({size:p.size,type:p.type})),progress,unchanged:before===JSON.stringify(window.reportRecords),drawn};
 });
 assert.equal(result.noteCount,2);assert.equal(result.photoCount,3);assert.ok(result.pageCount>3,'the complete long note flows onto continuation pages');
 assert.equal(result.previews.length,result.pageCount);assert.ok(result.previews.every(p=>p.size>0&&p.size<350000&&p.type.startsWith('image/')));
 assert.equal(result.type,'application/pdf');assert.ok(result.unchanged,'report generation does not mutate saved notes');
 assert.deepEqual(result.progress.filter(p=>p.completed>0).map(p=>p.completed),[1,2,3]);
 assert.ok(result.drawn.some(t=>t.includes('END_OF_NOTE')),'the final description text is included');
 const observationText=[];let reading=false;
 for(const value of result.drawn){if(value==='OBSERVATION'){reading=true;continue;}if(value==='2 notes  /  3 photos')reading=false;if(reading)observationText.push(value);}
 const compact=value=>value.replace(/\s+/gu,'');
 assert.equal(compact(observationText.join('')),compact(result.briefDescription+result.longDescription),'every description character survives line wrapping and pagination');
 assert.ok(result.drawn.some(t=>t.includes('18/11/2026')&&t.includes('9:05 AM')),'recorded time uses the app date/time format');
 const download=page.waitForEvent('download');await page.locator('#report-test-download').click();await (await download).saveAs('test-results/report-engine.pdf');
 const bytes=await readFile('test-results/report-engine.pdf'),pdf=bytes.toString('latin1');
 assert.ok(pdf.startsWith('%PDF-1.4'));assert.match(pdf,/\/Subtype \/Link/);assert.match(pdf,/https:\/\/maps.google.com\//);
 assert.equal((pdf.match(/\/Type \/Page\b/g)||[]).length,result.pageCount);
 assert.equal((pdf.match(/\/Subtype \/Image\b/g)||[]).length,result.pageCount+3,'every selected photo is embedded separately from the page text');
 const startxref=Number(pdf.match(/startxref\s+(\d+)\s+%%EOF/)[1]);assert.equal(pdf.slice(startxref,startxref+4),'xref');
 const xref=pdf.slice(startxref).split('\n'),count=Number(xref[1].split(' ')[1]);
 for(let id=1;id<count;id++){const offset=Number(xref[id+2].slice(0,10));assert.ok(pdf.slice(offset).startsWith(`${id} 0 obj`),`object ${id} has a byte-accurate offset`);}
 const imageRE=/(\d+) 0 obj\n(<<[^\n]*\/Subtype \/Image[^\n]*>>)\nstream\n/g;
 let found=false,match;
 while((match=imageRE.exec(pdf))){const dict=match[2];if(!/\/Width 1600\b/.test(dict)||!/\/Height 900\b/.test(dict))continue;
  const length=Number(dict.match(/\/Length (\d+)/)[1]),start=match.index+match[0].length,raw=inflateSync(bytes.subarray(start,start+length));
  assert.equal(raw.length,1600*900*3);assert.deepEqual([...raw.subarray(0,3)],[202,189,167],'the full-size cropped first pixel is lossless');assert.ok(raw.some((value,index)=>index%3===0 && value>240 && raw[index+1]<115 && raw[index+2]<115),'the cropped photo includes the red annotation');found=true;break;
 }
 assert.ok(found,'a photo is embedded at its exact original cropped pixel dimensions');
 const more=await page.evaluate(async()=>{
  const {buildReport}=window.reportEngine,base=window.reportRecords[1],controller=new AbortController();let cancelled=false,completed=0;
  try{await buildReport([base],{signal:controller.signal,onProgress:p=>{completed=p.completed;if(p.completed===1)controller.abort();}});}catch(e){cancelled=e.name==='AbortError';}
  const drawn=[],fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push(String(text));return fill.call(this,text,...args);};
  let privateReport;try{privateReport=await buildReport([{...base,photos:[base.photos[0]]}],{includeLocation:false,includeDate:false});}finally{CanvasRenderingContext2D.prototype.fillText=fill;}
  const pdf=await privateReport.blob.text();
  const single=await buildReport([{...base,photos:[base.photos[0]]}]);
  const compression=window.CompressionStream;let fallback,rawCancelled=false;
  try{
   window.CompressionStream=undefined;fallback=await buildReport([{...base,photos:[base.photos[0]]}],{includeLocation:false});
   const {ReportPDF}=await import('./pdf.js'),rawController=new AbortController(),canvas=document.createElement('canvas');canvas.width=canvas.height=2000;
   setTimeout(()=>rawController.abort(),0);
   try{await new ReportPDF().image(canvas,rawController.signal);}catch(error){rawCancelled=error.name==='AbortError';}finally{canvas.width=canvas.height=1;}
  }finally{window.CompressionStream=compression;}
  const fallbackText=await fallback.blob.text();
  let extremeError='',extremePages=0;
  try{
   const extreme=await buildReport([{...base,project:'W'.repeat(100),categoryName:'W'.repeat(60),address:{area:'W'.repeat(100),block:'W'.repeat(30),street:'W'.repeat(100)},description:'W'.repeat(4000),photos:[base.photos[0]]}],{title:'W'.repeat(200)});
   extremePages=extreme.pageCount;
   await buildReport([{...base,project:'W\n'.repeat(50),address:{area:'W\n'.repeat(50),block:'W\n'.repeat(15),street:'W\n'.repeat(50)},photos:[base.photos[0]]}],{title:'W\n'.repeat(100)});
  }catch(error){extremeError=error.message;}
  return {cancelled,completed,privateHasMap:pdf.includes('/Subtype /Link'),drawn,singlePages:single.pageCount,fallbackPages:fallback.pageCount,rawCancelled,extremeError,extremePages,fallbackRaw:!fallbackText.includes('/Filter /FlateDecode')};
 });
 assert.equal(more.extremeError,'','maximum-length valid title, metadata and description export completely');assert.ok(more.extremePages>1&&more.extremePages<15);
 assert.ok(more.rawCancelled,'Cancel interrupts an image stream even without compression support');
 assert.equal(more.fallbackPages,1);assert.ok(more.fallbackRaw,'older browsers can export an uncompressed PDF');
 assert.ok(more.cancelled);assert.equal(more.completed,1);assert.equal(more.privateHasMap,false);assert.equal(more.singlePages,1,'a brief note and a large landscape photo fit on one page');
 assert.ok(!more.drawn.some(t=>t.includes('18/11/2026')||t.includes('السالمية')||t.includes('شارع الخليج')||t.includes('29.333')),'disabled metadata is absent');
 console.log(`PASS: report engine, ${result.pageCount} pages, full-resolution lossless crop, all photos/annotations, long Arabic continuation, map links, privacy, cancellation, immutable notes and xref.`);
}finally{await browser.close();}
