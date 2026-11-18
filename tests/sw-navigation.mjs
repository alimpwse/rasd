import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve('dist');
let legacy=false;
const legacyWorker="const CACHE='rasd-shell-v2';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html']))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.match('./index.html'));});";
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 // Match production: the host canonicalizes index.html with a real redirect.
 if(path==='/index.html'){res.writeHead(307,{Location:'/'});res.end();return;}
 try {
  const file=resolve(root,path==='/'?'index.html':path.slice(1));
  if(!file.startsWith(root+'/'))throw new Error('outside root');
  const data=legacy && path==='/sw.js'?legacyWorker:await readFile(file);
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'}[extname(file)] || 'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext();const page=await context.newPage();
try {
 await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.waitForFunction(()=>navigator.serviceWorker.controller);
 await page.reload();
 assert.equal(await page.title(),'RASD — Field Notes');
 await page.goto(origin+'/index.html');
 assert.equal(await page.title(),'RASD — Field Notes');
 await context.setOffline(true);await page.goto(origin+'/');
 assert.equal(await page.title(),'RASD — Field Notes');
 const cached=await page.evaluate(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(n=>n.startsWith('rasd-shell-')));const response=await cache.match('./');return {redirected:response.redirected,status:response.status};});
 assert.deepEqual(cached,{redirected:false,status:200});
 const offlineReport=await page.evaluate(async()=>{
  const {buildReport}=await import('./report.js');
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;canvas.getContext('2d').fillRect(0,0,600,400);const blob=await new Promise(resolve=>canvas.toBlob(resolve));
  const result=await buildReport([{id:'offline-report',createdAt:'2026-11-18T08:00:00Z',project:'Offline site',description:'ملاحظة محفوظة دون إنترنت',address:{area:'',block:'',street:''},location:null,original:blob,thumbnail:blob,annotations:[]}]);
  return {pages:result.pageCount,photos:result.photoCount,type:result.blob.type,size:result.blob.size};
 });
 assert.equal(offlineReport.pages,1);assert.equal(offlineReport.photos,1);assert.equal(offlineReport.type,'application/pdf');assert.ok(offlineReport.size>1000);
 console.log('PASS: report modules and Arabic fonts generate a complete PDF offline.');

 console.log('PASS: canonical index redirect, controlled reload, direct index navigation and offline launch.');
 await context.close();
 legacy=true;
 const upgradeContext=await browser.newContext();
 const existing=await upgradeContext.newPage();await existing.goto(origin);
 await existing.evaluate(()=>navigator.serviceWorker.ready);await existing.waitForFunction(()=>navigator.serviceWorker.controller);
 const initial=await existing.evaluate(async()=>{
  const cache=await caches.open('rasd-shell-v2');const response=await cache.match('./index.html');
  const {saveNote}=await import('./storage.js');
  const image=new Blob(['original'],{type:'image/jpeg'});
  await saveNote({id:'preserve-this-note',createdAt:new Date().toISOString(),project:'My site',description:'ملاحظة محفوظة',address:{area:'',block:'',street:''},location:null,original:image,thumbnail:image,annotations:[]});
  localStorage.setItem('rasd-projects-v1',JSON.stringify({names:['My site'],active:'My site'}));
  window.unsavedMarker='keep this draft';window.recovered=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{window.recovered=true;});
  return response.redirected;
 });
 assert.equal(initial,true,'old shell must reproduce the actual redirected cached response');
 legacy=false;
 const incoming=await upgradeContext.newPage();
 try{await incoming.goto(origin);}catch(error){assert.match(error.message,/ERR_FAILED/);}
 await existing.waitForFunction(()=>window.recovered,{},{timeout:15000});
 assert.equal(await existing.evaluate(()=>window.unsavedMarker),'keep this draft','hotfix must not reload an open draft');
 await incoming.goto(origin);assert.equal(await incoming.title(),'RASD — Field Notes');
 const preserved=await incoming.evaluate(async()=>{const {listNotes}=await import('./storage.js');const notes=await listNotes();return {description:notes[0].description,bytes:await notes[0].original.text(),project:JSON.parse(localStorage.getItem('rasd-projects-v1')).active,oldCache:await caches.has('rasd-shell-v2')};});
 assert.deepEqual(preserved,{description:'ملاحظة محفوظة',bytes:'original',project:'My site',oldCache:false});
 await upgradeContext.setOffline(true);await incoming.reload();assert.equal(await incoming.title(),'RASD — Field Notes');
 console.log('PASS: broken v2 automatically recovers on navigation; saved original, Arabic note, project preference and open draft are retained; recovered shell opens offline.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
