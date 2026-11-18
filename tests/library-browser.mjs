import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4173');
 await page.evaluate(async()=>{
  const {saveNote}=await import('./storage.js');
  const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d');
  const entries=[['a','Salmiya Residence','شرخ بجانب النافذة','السالمية',0],['b','Salmiya Residence','Waterproofing needs review','السالمية',100000],['c','Bayan Extension','Door frame alignment','بيان',86400000],['d','','Older foundation check','',172800000]];
  for(const [id,project,description,area,age] of entries) {
   x.fillStyle=id==='c'?'#9cafa5':'#cfc5b2';x.fillRect(0,0,600,800);x.fillStyle='#566d76';x.fillRect(140,120,320,460);x.strokeStyle='#ece7db';x.lineWidth=14;x.strokeRect(140,120,320,460);x.beginPath();x.moveTo(300,120);x.lineTo(300,580);x.stroke();
   const blob=await new Promise(r=>c.toBlob(r,'image/png'));
   await saveNote({id,createdAt:new Date(Date.now()-age).toISOString(),project,description,address:{area,block:'5',street:'10'},location:null,original:blob,thumbnail:blob,annotations:[]});
  }
 });
 await page.locator('#nav-archive').click();await page.locator('.note-card').first().waitFor();assert.equal(await page.locator('.note-card').count(),4);
 await page.screenshot({path:'test-results/notes-organised-mobile.png',fullPage:true});
 await page.locator('#library-filters summary').click();
 await page.locator('#notes-project').selectOption('project:Salmiya Residence');assert.equal(await page.locator('.note-card').count(),2);
 await page.locator('#search').fill('نافذة');assert.equal(await page.locator('.note-card').count(),1);
 await page.locator('#search').fill('no match');await page.locator('#clear-filters').click();assert.equal(await page.locator('.note-card').count(),4);
 await page.locator('#notes-sort').selectOption('oldest');assert.ok((await page.locator('.note-card').first().textContent()).includes('Older foundation check'));
 await page.locator('.note-more').first().click();await page.locator('#library-note-delete').click();await page.locator('#confirm-no').click();
 assert.equal(await page.locator('#note-actions-dialog').evaluate(el=>el.open),true);await page.locator('#close-note-actions').click();assert.equal(await page.locator('.note-card').count(),4);
 await page.locator('.note-more').first().click();await page.locator('#library-note-delete').click();await page.locator('#confirm-yes').click();await page.waitForFunction(()=>document.querySelectorAll('.note-card').length===3);
 const ids=await page.evaluate(async()=>{const {listNotes}=await import('./storage.js');return (await listNotes()).map(n=>n.id);});assert.ok(!ids.includes('d'));assert.equal(ids.length,3);
 await page.locator('.note-open').first().click();await page.locator('#note-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#tab-edit').getAttribute('aria-selected'),'true');
 const deleteButton=await page.locator('#delete-note').boundingBox();assert.ok(deleteButton.y>=0 && deleteButton.y+deleteButton.height<844);
 await page.locator('#tab-edit').click();await page.locator('#editor-layout').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.locator('#close-note').click();await page.locator('.note-more').first().click();await page.locator('#library-note-edit').click();await page.locator('#note-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#tab-edit').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#editor-layout').evaluate(el=>el.scrollTop),0);
 await page.locator('#delete-note').click();await page.locator('#confirm-no').click();await page.locator('#close-note').click();
 await page.locator('#library-tools').click();assert.equal(await page.locator('#backup-button').isVisible(),true);assert.equal(await page.locator('#restore-button').isVisible(),true);
 await page.locator('#close-library-tools').click();assert.equal(await page.locator('#backup-button').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('button button').length),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: project/search/order/date groups, actions sheet edit/delete, cancel/confirm preservation, header delete, reopen resets Edit and scroll, backup tools separate.');
}finally{await browser.close();}
