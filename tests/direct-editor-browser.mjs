import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser,page,session;
const arrow={type:'arrow',x:.2,y:.3,x2:.6,y2:.5,color:'#ff5b55'};
const ellipse={type:'ellipse',x:.2,y:.2,x2:.6,y2:.6,color:'#ffffff'};
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:800,height:700},hasTouch:true,serviceWorkers:'block'});
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 await page.evaluate(async()=>{
  const {PhotoEditor}=await import('./editor.js');document.body.replaceChildren();
  const canvas=document.createElement('canvas');canvas.id='fixture';canvas.style.cssText='position:fixed;left:20px;top:20px;width:400px;height:auto;touch-action:none';document.body.append(canvas);
  const source=document.createElement('canvas');source.width=1600;source.height=1200;const ctx=source.getContext('2d');ctx.fillStyle='#708090';ctx.fillRect(0,0,1600,1200);
  window.photo=await new Promise(resolve=>source.toBlob(resolve));window.changes=0;window.selections=[];window.textEdits=[];window.legacyText='';
  window.editor=new PhotoEditor(canvas,()=>changes++,()=>legacyText,shape=>selections.push({shape,tool:editor.tool}), (shape,point)=>textEdits.push({shape,point}));
  window.constructorSelections=selections.length;await editor.load(photo);editor.setView('markup');
 });
 session=await page.context().newCDPSession(page);
});
afterEach(async()=>{await page.close();});
async function load(shapes,crop='original') {await page.evaluate(async({shapes,crop})=>{await editor.load(photo,shapes);editor.setRecord({crop:{ratio:crop}});editor.setView('markup');changes=0;selections=[];textEdits=[];},{shapes,crop});}
async function screen(x,y) {return page.evaluate(({x,y})=>{const c=editor.frame(),r=editor.canvas.getBoundingClientRect();return {x:r.left+(x*editor.width-c.x)*r.width/c.width,y:r.top+(y*editor.height-c.y)*r.height/c.height};},{x,y});}
async function tap(x,y) {const p=await screen(x,y);await page.touchscreen.tap(p.x,p.y);}
async function state() {return page.evaluate(()=>({shapes:editor.annotations,selected:editor.getSelected(),tool:editor.tool,changes,history:editor.history.length,textEdits}));}
async function touch(type,point) {await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{...point,radiusX:12,radiusY:12,force:1,id:1}]});}
async function drag(from,to) {await touch('touchStart',from);await touch('touchMove',to);await touch('touchEnd');}
function near(actual,want) {assert.ok(Math.abs(actual-want)<1e-6,`${actual} should equal ${want}`);}

test('drawing auto-selects each new annotation so the next touch can move it',async()=>{
 assert.equal(await page.evaluate(()=>constructorSelections),0);
 await load([arrow]);await tap(.4,.4);assert.deepEqual((await state()).selected,arrow);
 for(const type of ['arrow','ellipse']) {
  await load([]);await page.evaluate(type=>editor.setTool(type),type);await drag(await screen(.2,.3),await screen(.6,.5));
  const s=await state();assert.equal(s.tool,'select');assert.equal(s.selected.type,type);assert.equal(s.changes,1);assert.equal(s.history,1);
  assert.equal(await page.evaluate(()=>selections.at(-1).tool),'select');
  await drag(await screen(.4,.4),await screen(.5,.5));const moved=(await state()).shapes[0];near(moved.x,.3);near(moved.y,.4);
  await page.evaluate(()=>editor.undo());near((await state()).shapes[0].x,.2);
 }
});

test('touching within 22px of either arrow endpoint changes that endpoint only, including direction in a crop',async()=>{
 await load([arrow],'16:9');await tap(.4,.4);
 const end=await screen(.6,.5);await drag({x:end.x+18,y:end.y},{x:end.x+58,y:end.y-60});
 let s=(await state()).shapes[0];near(s.x,.2);near(s.y,.3);near(s.x2,.7);near(s.y2,.3);
 const start=await screen(.2,.3);await drag(start,{x:start.x-40,y:start.y+60});
 s=(await state()).shapes[0];near(s.x,.1);near(s.y,.5);near(s.x2,.7);near(s.y2,.3);
 assert.equal((await state()).changes,2);await page.evaluate(()=>editor.undo());near((await state()).shapes[0].x,.2);
 await page.evaluate(()=>editor.undo());assert.deepEqual((await state()).shapes,[arrow]);
});

test('ellipse corners independently resize the bounding box with the opposite corner fixed',async()=>{
 await load([ellipse]);await tap(.4,.4);
 await drag(await screen(.6,.6),await screen(.8,.7));let s=(await state()).shapes[0];near(s.x,.2);near(s.y,.2);near(s.x2,.8);near(s.y2,.7);
 await drag(await screen(.2,.7),await screen(.1,.8));s=(await state()).shapes[0];near(s.x,.1);near(s.y,.2);near(s.x2,.8);near(s.y2,.8);
 assert.equal((await state()).history,2);await page.evaluate(()=>editor.undo());near((await state()).shapes[0].x,.2);
});

test('Arabic text corner resizes uniformly and clamps scale while preserving its anchor',async()=>{
 const original={type:'text',x:.8,y:.3,text:'ملاحظة عربية طويلة',color:'#ffffff'};await load([original]);await tap(.6,.32);
 const rect=await page.evaluate(()=>editor.selectionRect?.());assert.ok(rect,'selected annotations expose canvas-local CSS bounds');
 const anchor={x:20+rect.left+rect.width,y:20+rect.top},corner={x:20+rect.left,y:20+rect.top+rect.height};
 await drag(corner,{x:anchor.x+(corner.x-anchor.x)*1.5,y:anchor.y+(corner.y-anchor.y)*1.5});
 let s=(await state()).selected;near(s.x,.8);near(s.y,.3);near(s.scale,1.5);
 for(const [factor,want] of [[20,3],[.01,.4]]) {
  const r=await page.evaluate(()=>editor.selectionRect());const a={x:20+r.left+r.width,y:20+r.top},p={x:20+r.left,y:20+r.top+r.height};
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(a.x+(p.x-a.x)*factor,a.y+(p.y-a.y)*factor);await page.mouse.up();near((await state()).selected.scale,want);
 }
});

test('cancelled handle gestures restore committed export and draft values without undo or dirty events',async()=>{
 await load([arrow]);const baseline=await page.evaluate(async()=>Array.from(new Uint8Array(await(await editor.export()).arrayBuffer())));await tap(.4,.4);
 const p=await screen(.6,.5);await touch('touchStart',p);await touch('touchMove',{x:p.x+80,y:p.y-60});
 assert.notDeepEqual((await state()).shapes,[arrow]);assert.deepEqual(await page.evaluate(()=>editor.committedAnnotations()),[arrow]);
 assert.deepEqual(await page.evaluate(async()=>Array.from(new Uint8Array(await(await editor.export()).arrayBuffer()))),baseline);
 await touch('touchCancel');const s=await state();assert.deepEqual(s.shapes,[arrow]);assert.equal(s.changes,0);assert.equal(s.history,0);
 await page.evaluate(()=>editor.setTool('ellipse'));await touch('touchStart',await screen(.1,.1));await touch('touchMove',await screen(.4,.3));
 assert.deepEqual(await page.evaluate(async()=>Array.from(new Uint8Array(await(await editor.export()).arrayBuffer()))),baseline);await touch('touchCancel');assert.deepEqual((await state()).shapes,[arrow]);
});

test('blank text tool requests an inline entry without placeholders, then valid text creates a single undo step',async()=>{
 await page.evaluate(()=>editor.setTool('text'));await tap(.3,.4);let s=await state();assert.equal(s.textEdits.length,1);assert.equal(s.textEdits[0].shape,null);near(s.textEdits[0].point.x,.3);near(s.textEdits[0].point.y,.4);assert.deepEqual(s.shapes,[]);assert.equal(s.changes,0);
 assert.equal(await page.evaluate(()=>editor.addTextAt?.('  ',textEdits[0].point)),false);assert.equal(await page.evaluate(()=>editor.addTextAt?.('a'.repeat(161),textEdits[0].point)),false);
 assert.equal(await page.evaluate(()=>editor.addTextAt?.('  Direct text  ',textEdits[0].point)),true);s=await state();assert.equal(s.selected.text,'Direct text');assert.equal(s.tool,'select');assert.equal(s.changes,1);assert.equal(s.history,1);
 await page.evaluate(()=>editor.undo());assert.deepEqual((await state()).shapes,[]);
 await page.evaluate(()=>{legacyText='Legacy';editor.setTool('text');});await tap(.2,.2);s=await state();assert.equal(s.selected.text,'Legacy');assert.equal(s.tool,'select');assert.equal(s.textEdits.length,1);
});

test('a second text tap opens editing once; dragging and double-click completion never duplicate it',async()=>{
 const original={type:'text',x:.2,y:.2,text:'A long annotation',color:'#ffffff'};await load([original]);await tap(.3,.22);assert.equal((await state()).textEdits.length,0);
 await tap(.3,.22);let s=await state();assert.equal(s.textEdits.length,1);assert.deepEqual(s.textEdits[0].shape,original);
 await drag(await screen(.3,.22),await screen(.4,.32));assert.equal((await state()).textEdits.length,1);
 await load([original]);const p=await screen(.3,.22);await page.mouse.dblclick(p.x,p.y);assert.equal((await state()).textEdits.length,1);
 assert.equal((await state()).changes,0);
});

test('double-clicking text that was already selected requests one inline editor',async()=>{
 await load([{type:'text',x:.2,y:.2,text:'A long annotation',color:'#ffffff'}]);await tap(.3,.22);
 const p=await screen(.3,.22);await page.mouse.dblclick(p.x,p.y);assert.equal((await state()).textEdits.length,1);
});
