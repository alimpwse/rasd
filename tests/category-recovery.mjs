import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'}),page=await context.newPage();
page.setDefaultTimeout(12000);
try {
 await context.addInitScript(()=>{
  window.painted=[];const fillText=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.painted.push(text);return fillText.call(this,text,...args);};
  window.shared=[];navigator.canShare=()=>true;navigator.share=async data=>{window.shared.push({text:data.text,png:Array.from(new Uint8Array(await data.files[0].arrayBuffer()))});};
 });
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 await page.locator('#nav-settings').click();await page.locator('#stamp-category').check();await page.locator('#message-category').check();await page.locator('#close-settings').click();
 const bytes=await page.evaluate(async()=>{
  const {saveNote}=await import('./storage.js');const c=document.createElement('canvas');c.width=600;c.height=800;
  const original=await new Promise(resolve=>c.toBlob(resolve));
  await saveNote({id:'recovered-note',createdAt:'2020-01-01T09:00:00Z',project:'',description:'',address:{area:'',block:'',street:''},location:null,original,thumbnail:original,annotations:[],category:'safety',categoryName:'Inspection'});
  localStorage.setItem('rasd-categories-v1',JSON.stringify({entries:[],defaultId:'safety'}));
  return Array.from(new Uint8Array(await original.arrayBuffer()));
 });
 const source=await readFile(new URL('../dist/storage.js',import.meta.url),'utf8');
 await context.route('**/storage.js',route=>route.fulfill({contentType:'text/javascript',body:source.replace('export const listNotes=','const rawListNotes=')+`\nlet firstRead=true;export const listNotes=()=>{if(firstRead){firstRead=false;return new Promise(resolve=>{window.releaseInitialNotes=()=>rawListNotes().then(resolve);});}return rawListNotes();};`}));
 await page.reload();await page.waitForFunction(()=>!!window.releaseInitialNotes);
 await page.locator('#native-input').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
 await page.locator('#save-button').click();await page.getByText('Saved on this device.',{exact:true}).waitFor();
 await page.locator('#share-button').click();await page.waitForFunction(()=>shared.length===1);
 assert.ok(await page.evaluate(()=>painted.includes('Safety')));
 await page.evaluate(()=>{painted=[];releaseInitialNotes();});
 await page.waitForFunction(()=>document.querySelector('#category').selectedOptions[0].textContent==='Inspection');
 await page.waitForFunction(()=>painted.includes('Inspection'),{},{timeout:2500});
 assert.match(await page.locator('#save-status').textContent(),/Saving draft|Draft saved/);
 await page.locator('#share-button').click();await page.waitForFunction(()=>shared.length===2);
 const [before,after]=await page.evaluate(()=>shared);assert.match(after.text,/Category: Inspection/);assert.notDeepEqual(after.png,before.png,'printed PNG must refresh with the recovered label');
 console.log('PASS: late category recovery refreshes the printed PNG and caption together and keeps the changed saved note dirty.');
} finally {await browser.close();}
