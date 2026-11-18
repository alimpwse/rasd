import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const origin=process.env.TEST_URL || 'http://127.0.0.1:4173';
const context=await browser.newContext({viewport:{width:320,height:568},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {saveNote}=await import('./storage.js'),c=document.createElement('canvas');c.width=400;c.height=300;c.getContext('2d').fillRect(0,0,400,300);const blob=await new Promise(r=>c.toBlob(r));
  for(let i=0;i<21;i++)await saveNote({id:`limit-${i}`,createdAt:'2026-11-18T10:00:00Z',project:i<6?'Many photos':'Single photo',description:`Observation ${i}`,address:{area:'',block:'',street:''},location:null,photos:Array.from({length:i<6?10:1},(_,j)=>({id:`p-${j}`,original:blob,thumbnail:blob,annotations:[]}))});
 });
 await page.locator('#nav-archive').click();await page.locator('.note-card').first().waitFor();await page.locator('#library-select').click();await page.locator('#select-visible').click();assert.match(await page.locator('#toast').textContent(),/20 notes/);assert.match(await page.locator('#selection-summary').textContent(),/0 notes/);
 await page.locator('#search').fill('Many photos');await page.locator('#select-visible').click();assert.match(await page.locator('#toast').textContent(),/50 photos/);assert.match(await page.locator('#selection-summary').textContent(),/0 notes/);
 await page.locator('#search').fill('Observation 20');await page.locator('#select-visible').click();await page.evaluate(async()=>{await (await import('./storage.js')).deleteNote('limit-20');});
 await page.locator('#create-report').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('removed'));assert.equal(await page.locator('#report-dialog').isVisible(),false);
 await page.locator('#nav-archive').click();await page.waitForFunction(()=>document.querySelector('#selection-summary').textContent.startsWith('0 notes'));
 await page.locator('#search').fill('Observation 19');await page.locator('#select-visible').click();await page.locator('#create-report').click();await page.locator('#report-dialog').waitFor({state:'visible'});
 const button=await page.locator('#generate-report').boundingBox();assert.ok(button.y>=0&&button.y+button.height<=568,'Preview report is reachable without scrolling on a small screen');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'test-results/report-setup-small.png'});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'test-results/report-setup-light.png'});
 await page.locator('#close-report').click();
 // A valid record with an unreadable photo must expose an error, never a partial PDF.
 await page.evaluate(async()=>{const {listNotes,saveNote}=await import('./storage.js');const note=(await listNotes()).find(n=>n.id==='limit-19');note.photos[0].original=new Blob(['invalid photo'],{type:'image/png'});await saveNote(note);});
 await page.locator('#create-report').click();await page.locator('#generate-report').click();await page.waitForFunction(()=>!!document.querySelector('#report-error').textContent);assert.equal(await page.locator('#report-ready').isVisible(),false);assert.equal(await page.locator('#report-setup').isVisible(),true);await page.locator('#close-report').click();
 assert.deepEqual(errors,[]);
 // A deliberately slow dependency models work finishing after cancellation, even if it ignores AbortSignal.
 const race=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'}),r=await race.newPage();
 await r.route('**/report.js',route=>route.fulfill({contentType:'text/javascript',body:`export const MAX_REPORT_NOTES=20,MAX_REPORT_PHOTOS=50;export const reportSummary=r=>({noteCount:r.length,photoCount:r.length});export async function buildReport(r,o){window.builds=(window.builds||0)+1;const n=window.builds;await new Promise(resolve=>setTimeout(resolve,n===1?600:20));window.finished=(window.finished||0)+1;return {blob:new Blob(['PDF'+n],{type:'application/pdf'}),previews:[],pageCount:n,noteCount:r.length,photoCount:r.length};}` }));
 await r.goto(origin);await r.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=2;const b=await new Promise(r=>c.toBlob(r));await (await import('./storage.js')).saveNote({id:'race',createdAt:new Date().toISOString(),project:'Test',description:'Test',address:{area:'',block:'',street:''},location:null,original:b,thumbnail:b,annotations:[]});});
 await r.locator('#nav-archive').click();await r.locator('#library-select').click();await r.locator('#select-visible').click();await r.locator('#create-report').click();await r.locator('#generate-report').click();await r.waitForFunction(()=>window.builds===1);await r.locator('#cancel-report-build').click();
 await r.locator('#report-title').fill('Current report');await r.locator('#generate-report').click();await r.locator('#report-ready').waitFor();await r.waitForFunction(()=>window.finished===2);assert.match(await r.locator('#report-file-info').textContent(),/^2 pages/);assert.equal(await r.locator('#share-report').isVisible(),false);assert.match(await r.locator('#report-share-help').textContent(),/Save the PDF to Files/);
 const [file]=await Promise.all([r.waitForEvent('download'),r.locator('#save-report').click()]);assert.equal(file.suggestedFilename(),'Current report.pdf');assert.equal(await readFile(await file.path(),'utf8'),'PDF2');await race.close();
 console.log('PASS: atomic selection limits, deleted-note reconciliation, small-screen/light layout, unreadable photo error, cancelled result isolation, download fallback.');
}finally{await browser.close();}
