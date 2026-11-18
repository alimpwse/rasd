import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser,page;
const arrow={type:'arrow',x:.2,y:.3,x2:.6,y2:.5,color:'#ff5b55'};
const ellipse={type:'ellipse',x:.2,y:.2,x2:.6,y2:.6,color:'#ffffff'};
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser.close();});
beforeEach(async()=>{
 page=await browser.newPage({viewport:{width:800,height:700},serviceWorkers:'block'});
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 await page.evaluate(async()=>{
  const {PhotoEditor}=await import('./editor.js');
  document.body.replaceChildren();const canvas=document.createElement('canvas');canvas.id='fixture';
  canvas.style.cssText='position:fixed;left:20px;top:20px;width:400px;height:auto;touch-action:none';document.body.append(canvas);
  const source=document.createElement('canvas');source.width=1600;source.height=1200;const ctx=source.getContext('2d');ctx.fillStyle='#708090';ctx.fillRect(0,0,1600,1200);
  window.photo=await new Promise(resolve=>source.toBlob(resolve));window.changes=0;window.selections=[];
  window.editor=new PhotoEditor(canvas,()=>window.changes++,()=>'New text',shape=>window.selections.push(shape));
  await window.editor.load(window.photo);window.editor.setView('markup');
 });
});
afterEach(async()=>{await page.close();});
async function load(shapes,crop='original') {
 await page.evaluate(async({shapes,crop})=>{
  await editor.load(photo,shapes);editor.setRecord({crop:{ratio:crop}});editor.setView('markup');
  if(editor.setTool)editor.setTool('select');else editor.tool='select';
  window.changes=0;window.selections=[];
 },{shapes,crop});
}
async function screen(x,y) {
 return page.evaluate(({x,y})=>{const c=editor.frame(),r=editor.canvas.getBoundingClientRect();return {x:r.left+(x*editor.width-c.x)*r.width/c.width,y:r.top+(y*editor.height-c.y)*r.height/c.height};},{x,y});
}
async function click(x,y,offset={x:0,y:0}) {const p=await screen(x,y);await page.mouse.click(p.x+offset.x,p.y+offset.y);}
async function selected() {return page.evaluate(()=>editor.getSelected?.() ?? null);}
async function shapes() {return page.evaluate(()=>editor.annotations);}
function near(actual,want) {assert.ok(Math.abs(actual-want)<1e-8,`${actual} should equal ${want}`);}

test('select picks the topmost annotation with touch tolerance and blank clicks never add',async()=>{
 await load([arrow,ellipse]);await click(.4,.4);assert.deepEqual(await selected(),ellipse);
 await click(.95,.9);assert.equal(await selected(),null);assert.equal((await shapes()).length,2);
 await load([arrow]);await click(.4,.4,{x:0,y:10});assert.deepEqual(await selected(),arrow);
 await page.evaluate(()=>{const copy=editor.getSelected();copy.color='#000000';});assert.equal((await shapes())[0].color,arrow.color);
 assert.equal(await page.evaluate(()=>changes),0);
});

test('drag maps a cropped canvas to original coordinates, clamps movement and records one undo step',async()=>{
 const original={...arrow,x2:.4,y2:.4};await load([original],'16:9');const p=await screen(.3,.35);
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+80,p.y+40,{steps:4});
 assert.equal(await page.evaluate(()=>changes),0);await page.mouse.up();
 let moved=(await shapes())[0];near(moved.x,.4);near(moved.x2,.6);near(moved.y,.3+2/15);near(moved.y2,.4+2/15);
 assert.equal(await page.evaluate(()=>changes),1);await page.evaluate(()=>editor.undo());assert.deepEqual(await shapes(),[original]);
 await click(.3,.35);const q=await screen(.3,.35);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+900,q.y+900);await page.mouse.up();
 moved=(await shapes())[0];near(moved.x,.8);near(moved.x2,1);near(moved.y,.9);near(moved.y2,1);
 assert.equal(await page.evaluate(()=>changes),3);
});

test('cancelled selection drags restore the baseline without adding history or dirty events',async()=>{
 await load([arrow]);const p=await screen(.4,.4);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+40,p.y+30);
 await page.evaluate(()=>editor.canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));await page.mouse.up();
 assert.deepEqual(await shapes(),[arrow]);assert.equal(await page.evaluate(()=>changes),0);
 await page.evaluate(()=>editor.undo());assert.deepEqual(await shapes(),[arrow]);
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+40,p.y+30);await page.evaluate(()=>editor.setView('preview'));await page.mouse.up();
 assert.deepEqual(await shapes(),[arrow]);assert.equal(await selected(),null);assert.equal(await page.evaluate(()=>changes),0);
});

test('Arabic text can be selected, recolored, resized, edited and deleted with distinct undo steps',async()=>{
 const original={type:'text',x:.8,y:.2,text:'ملاحظة عربية',color:'#ffffff'};await load([original]);await click(.76,.22);assert.deepEqual(await selected(),original);
 await page.evaluate(()=>editor.setColor('#ffd166'));assert.equal((await selected()).color,'#ffd166');
 await page.evaluate(()=>editor.resizeSelected(1.2));near((await selected()).scale,1.2);
 await page.evaluate(()=>editor.updateSelectedText('  معالجة A-12  '));assert.equal((await selected()).text,'معالجة A-12');
 await page.evaluate(()=>{editor.updateSelectedText('  ');editor.updateSelectedText('a'.repeat(161));editor.resizeSelected(-2);editor.setColor('bad');});
 assert.equal(await page.evaluate(()=>changes),3);assert.equal((await selected()).color,'#ffd166');
 await page.evaluate(()=>editor.deleteSelected());assert.deepEqual(await shapes(),[]);assert.equal(await selected(),null);
 await page.evaluate(()=>editor.undo());assert.equal((await shapes())[0].text,'معالجة A-12');
 await page.evaluate(()=>editor.undo());assert.equal((await shapes())[0].text,original.text);
 await page.evaluate(()=>editor.undo());assert.equal((await shapes())[0].scale,undefined);
 await page.evaluate(()=>editor.undo());assert.deepEqual(await shapes(),[original]);assert.equal(await page.evaluate(()=>changes),8);
});

test('resizing uses shape centers and keeps endpoints and text scale within their limits',async()=>{
 await load([{...ellipse,x:.2,y:.3,x2:.8,y2:.7}]);await click(.5,.5);await page.evaluate(()=>editor.resizeSelected(10));
 let s=(await shapes())[0];near(s.x,0);near(s.x2,1);near(s.y,1/6);near(s.y2,5/6);
 await page.evaluate(()=>editor.undo());await page.evaluate(()=>editor.resizeSelected(.5));s=(await shapes())[0];near(s.x,.35);near(s.x2,.65);near(s.y,.4);near(s.y2,.6);
 await load([{type:'text',x:.2,y:.2,text:'Text',color:'#ffffff'}]);await click(.23,.22);
 await page.evaluate(()=>editor.resizeSelected(100));assert.equal((await selected()).scale,3);
 await page.evaluate(()=>editor.resizeSelected(.001));assert.equal((await selected()).scale,.4);
});

test('the 200 annotation limit blocks additions but still allows selection, edits and deletion',async()=>{
 await load(Array.from({length:200},()=>({...arrow})));await click(.4,.4);assert.deepEqual(await selected(),arrow);
 await page.evaluate(()=>editor.deleteSelected());assert.equal((await shapes()).length,199);
 await page.evaluate(()=>editor.undo());assert.equal((await shapes()).length,200);
 await page.evaluate(()=>editor.setTool('text'));await click(.1,.1);assert.equal((await shapes()).length,200);
});

test('selection guides appear only in markup, never in full-resolution export or thumbnails',async()=>{
 await load([ellipse]);
 const before=await page.evaluate(async()=>({full:Array.from(new Uint8Array(await(await editor.export()).arrayBuffer())),thumb:Array.from(new Uint8Array(await(await editor.export(320)).arrayBuffer())),preview:editor.canvas.toDataURL()}));
 await click(.4,.4);assert.deepEqual(await selected(),ellipse);
 const after=await page.evaluate(async()=>({full:Array.from(new Uint8Array(await(await editor.export()).arrayBuffer())),thumb:Array.from(new Uint8Array(await(await editor.export(320)).arrayBuffer())),preview:editor.canvas.toDataURL()}));
 assert.deepEqual(after.full,before.full);assert.deepEqual(after.thumb,before.thumb);assert.notEqual(after.preview,before.preview);
});

test('preview blocks mutations, and loading or clearing a photo resets edit history and selection',async()=>{
 await load([arrow]);await click(.4,.4);
 await page.evaluate(()=>editor.setView('preview'));
 await click(.4,.4);await page.evaluate(()=>{editor.undo();editor.setColor?.('#ffffff');editor.resizeSelected?.(2);editor.updateSelectedText?.('changed');editor.deleteSelected?.();});
 assert.deepEqual(await shapes(),[arrow]);assert.equal(await selected(),null);assert.equal(await page.evaluate(()=>changes),0);
 await page.evaluate(()=>{editor.setView('markup');editor.setTool('select');});await click(.4,.4);await page.evaluate(()=>editor.setColor('#ffffff'));
 await page.evaluate(async()=>{await editor.load(photo,[{type:'ellipse',x:.1,y:.1,x2:.5,y2:.5,color:'#ffffff'}]);editor.undo();});
 assert.equal((await shapes())[0].type,'ellipse');assert.equal(await selected(),null);
 await page.evaluate(()=>{editor.clear();editor.undo();});assert.deepEqual(await shapes(),[]);assert.equal(await selected(),null);
});

test('adding a shape remains undoable after editing an earlier shape',async()=>{
 await load([arrow]);await click(.4,.4);await page.evaluate(()=>editor.setColor('#ffffff'));
 await page.evaluate(()=>editor.setTool('ellipse'));const a=await screen(.7,.6),b=await screen(.9,.8);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up();
 assert.equal((await shapes()).length,2);await page.evaluate(()=>editor.undo());assert.deepEqual(await shapes(),[{...arrow,color:'#ffffff'}]);
 await page.evaluate(()=>editor.undo());assert.deepEqual(await shapes(),[arrow]);assert.equal(await page.evaluate(()=>changes),4);
});

test('unchanged edits preserve a legacy text annotation and do not create undo or dirty events',async()=>{
 const original={type:'text',x:.2,y:.2,text:'Text',color:'#ffffff'};await load([original]);await click(.23,.22);
 await page.evaluate(()=>{editor.setColor('#ffffff');editor.updateSelectedText('  Text  ');editor.resizeSelected(1);editor.undo();});
 assert.deepEqual(await shapes(),[original]);assert.equal(await page.evaluate(()=>changes),0);
});
