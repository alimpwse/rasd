import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
function worker({names=['rasd-shell-v2'],failInstall=false}={}) {
 const handlers={},added=[],deleted=[];let skipped=0,claimed=0;
 const cache={match:async()=>new Response('active shell'),addAll:async requests=>{if(failInstall)throw new Error('network');added.push(...requests);}};
 vm.runInNewContext(source,{
  self:{location:{origin:'https://rasd.example'},registration:{scope:'https://rasd.example/'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}},
  caches:{open:async()=>cache,match:async()=>new Response('older shell from another cache'),keys:async()=>names,delete:async name=>{deleted.push(name);}},
  fetch:async()=>new Response('unaccepted next version'),URL,Request,Response,
 });
 return {handlers,added,deleted,get skipped(){return skipped;},get claimed(){return claimed;}};
}
test('navigation reads the active shell cache instead of older cache entries',async()=>{
 const w=worker();let result;
 w.handlers.fetch({request:{url:'https://rasd.example/',method:'GET',mode:'navigate'},respondWith:p=>{result=p;}});
 assert.equal(await(await result).text(),'active shell');
});
test('precache uses canonical root and rejects redirect responses',async()=>{
 const w=worker();let pending;w.handlers.install({waitUntil:p=>{pending=p;}});await pending;
 assert.ok(w.added.every(request=>request instanceof Request && request.redirect==='error'));
 assert.ok(w.added.some(request=>request.url==='https://rasd.example/'));
 assert.ok(w.added.every(request=>!request.url.endsWith('/index.html')));
});
test('recovery activates after successful install without a broken-page click',async()=>{
 const w=worker();let pending;w.handlers.install({waitUntil:p=>{pending=p;}});await pending;assert.equal(w.skipped,1);
});
test('failed precache does not activate an incomplete shell',async()=>{
 const w=worker({failInstall:true});let pending;w.handlers.install({waitUntil:p=>{pending=p;}});
 await assert.rejects(pending,/network/);assert.equal(w.skipped,0);
});
test('future non-recovery shell updates still wait for explicit acceptance',async()=>{
 const w=worker({names:['rasd-shell-v3']});let pending;w.handlers.install({waitUntil:p=>{pending=p;}});await pending;assert.equal(w.skipped,0);
});
test('activation removes only obsolete app caches and claims clients',async()=>{
 const w=worker({names:['rasd-shell-v2','rasd-shell-v8','unrelated-cache']});let pending;w.handlers.activate({waitUntil:p=>{pending=p;}});await pending;
 assert.deepEqual(w.deleted,['rasd-shell-v2','rasd-shell-v8']);assert.equal(w.claimed,1);
});
