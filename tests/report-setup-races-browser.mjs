import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera'],serviceWorkers:'block'});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const source=await readFile('dist/storage.js','utf8');
await page.route('**/storage-real.js',route=>route.fulfill({body:source,contentType:'text/javascript'}));
await page.route('**/storage.js',route=>route.fulfill({contentType:'text/javascript',body:`export * from './storage-real.js';import * as real from './storage-real.js';async function gate(kind){if(window.holdSetup===kind){window.holdSetup=null;window.setupPaused=true;await new Promise(resolve=>window.releaseSetup=resolve);}}export const listNotes=async()=>{const rows=await real.listNotes();await gate('notes');return rows;};export const listDrafts=async()=>{const rows=await real.listDrafts();await gate('drafts');return rows;};`}));
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=4;const b=await new Promise(r=>c.toBlob(r));await (await import('./storage.js')).saveNote({id:'race-note',createdAt:new Date().toISOString(),project:'Saved site',description:'Original observation',address:{area:'',block:'',street:''},location:null,original:b,thumbnail:b,annotations:[]});});
 const select=async()=>{await page.locator('#nav-archive').click();await page.locator('.note-card').waitFor();if(await page.locator('#library-select').textContent()==='Select')await page.locator('#library-select').click();if(!await page.locator('.note-select').isChecked())await page.locator('.note-open').click();};
 const pause=async kind=>{await page.evaluate(kind=>{window.holdSetup=kind;window.setupPaused=false;},kind);await page.locator('#create-report').click();await page.waitForFunction(()=>window.setupPaused);};
 const release=async()=>{await page.evaluate(()=>window.releaseSetup());await page.waitForTimeout(100);};
 await select();await pause('notes');await page.locator('#nav-camera').click();await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'leaving Notes invalidates a pending report setup');
 await select();await pause('drafts');await page.locator('.note-open').click();await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'changing selection invalidates setup');
 await select();await pause('drafts');await page.locator('#library-select').click();await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'Cancel selection invalidates setup');
 await select();await pause('drafts');await page.locator('#nav-settings').click();await page.locator('#close-settings').click();await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'opening then closing Settings cancels pending setup');
 for(const [open,close] of [['library-tools','close-library-tools'],['help-button','close-help']]){await pause('drafts');await page.locator('#'+open).click();await page.locator('#'+close).click();await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'another dialog permanently cancels pending setup');}
 await select();await page.locator('#create-report').click();await page.locator('#report-dialog').waitFor({state:'visible'});await page.locator('#close-report').click();
 await pause('drafts');await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'rasd-restore-revision',newValue:'restored'})));await page.locator('#data-status-dialog').waitFor({state:'visible'});await release();assert.equal(await page.locator('#report-dialog').isVisible(),false,'restore reload gate cannot be covered by a stale report dialog');
 assert.deepEqual(errors,[]);console.log('PASS: deferred saved-note/draft reads cannot reopen reports after navigation, selection changes, Cancel, another modal, or restore revision.');
}finally{await browser.close();}
