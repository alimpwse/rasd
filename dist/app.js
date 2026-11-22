import {Camera} from './camera.js';
import {HoldVideoCapture} from './video-capture.js';
import {prepareVideo,inspectVideo} from './video.js';
import {ReportUI} from './report-ui.js';
import {calendarDate} from './datetime.js';
import {encodeFullBackup,decodeFullBackup,restoreFullBackup,recoverPendingRestore} from './backup.js';
import {PhotoEditor,loadImage} from './editor.js';
import {mapsURL,shareText,formatDate,MAX_PHOTO_BYTES,MAX_BACKUP_BYTES,MAX_NOTE_PHOTOS,MAX_NOTE_BYTES,photosOf,encodeBackup,isVideo,mediaExtension} from './model.js';
import {Phrases} from './phrases.js';
import {listNotes,listDrafts,deleteDraft,deleteNote,importNotes} from './storage.js';
import {DraftSession} from './drafts.js';
import {normalizeStamp} from './stamp.js';
import {Projects} from './projects.js';
import {libraryView,noteTime} from './library.js';
import {Preferences,normalizeExport,MESSAGE_FIELDS} from './preferences.js';
import {normalizeCrop} from './framing.js';
import {Categories,categoryLabel} from './categories.js';
import {AddressLookup} from './address.js';

const $=id=>document.getElementById(id);
let activeScreen='camera', draft=null, dirty=false, saved=false, notes=[], thumbnails=[];
let prepared=null, exportGeneration=0, exportRequest=0, prepareTimer, locationGeneration=0;
let busy=false,picking=false,loadingPhoto=false,openingNote=false,revision=0,offlineReady=false,toastTimer;
let draftSession=null,draftTimer,lastDraftRevision=-1,recoverableDrafts=[],draftThumbnails=[],draftListGeneration=0;
let activePhotoIndex=0,photoURLs=[],renderQueue=Promise.resolve(),textEditing=false,textPoint=null,editingPhraseId='';
let nextCapture=null;
let videoCapture=null,videoState='idle',videoURLs=[];
const fields=['description','project','area','block','street','category'];
// Finish any interrupted full restore before reading preferences or starting capture.
let storageStartupError;
try{await recoverPendingRestore();}
catch(error){
  if(error.pendingRestore){showDataStatus('Restore needs attention',error.message,true);await new Promise(()=>{});}
  storageStartupError=error;
}
// Unknown storage state permits capture/export, but never persistent changes.
const sessionStorageOnly=storageStartupError?{getItem:key=>window.localStorage.getItem(key),setItem:()=>{throw new Error('Storage unavailable. Reload RASD to save settings.');}}:undefined;
const projects=new Projects(sessionStorageOnly);
const categories=new Categories(sessionStorageOnly);
const phrases=new Phrases(sessionStorageOnly);
let editingCategoryId='';
const preferences=new Preferences(sessionStorageOnly),addressLookup=new AddressLookup();
let addressController,addressLocks=new Set();
let projectTarget='active-project';
let editorView='edit',libraryActionNote=null,selectedAnnotationIndex=-1;
const camera=new Camera($('camera-video'),(state,message)=>{
  $('camera-placeholder').hidden=state==='live';
  $('camera-message').textContent=message;
  syncAcquisitionControls();
  $('restart-camera').textContent=state==='starting'?'Starting…':'Restart preview';
  $('restart-camera').disabled=state==='starting';
  $('viewfinder').classList.toggle('is-live',state==='live');
});
const reports=new ReportUI({render:renderArchive,getRecords:async()=>(await listNotes()).map(resolveCategory),getDrafts:listDrafts,notify,download});
const editor=new PhotoEditor($('edit-canvas'),()=>{markDirty();queuePrepare();},()=>'',()=>syncSelection(),showPhotoText);

function requirePersistence(){
  if(storageStartupError)throw new Error('Storage unavailable. You can capture and export photos. Reload RASD before saving or restoring data.');
}
function showDataStatus(title,message,reload=false){
  $('data-status-title').textContent=title;$('data-status-message').textContent=message;
  $('data-reload').hidden=!reload;$('data-reload').onclick=()=>{dirty=false;location.reload();};
  document.querySelector('.app-shell').inert=true;
  for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='data-status-dialog')dialog.inert=true;
  $('data-status-dialog').oncancel=event=>event.preventDefault();
  if(!$('data-status-dialog').open)$('data-status-dialog').showModal();
}
function closeDataStatus(){
  $('data-status-dialog').close();document.querySelector('.app-shell').inert=false;
  for(const dialog of document.querySelectorAll('dialog'))dialog.inert=false;
}
window.addEventListener('storage',event=>{
  if(event.key==='rasd-restore-revision'){
    videoCapture?.cancel();
    nextCapture=null;syncNextCapture();
    reports.close();camera.stop();showDataStatus('Backup restored in another window','Reload RASD to use the restored notes and settings. Any unsaved edits in this window are not in the restored backup.',true);
  }
});
function syncAcquisitionControls() {
  for(const button of document.querySelectorAll('.app-shell button'))if(button.id!=='shutter')button.disabled=loadingPhoto || openingNote || videoState!=='idle';
  $('active-project').disabled=loadingPhoto || openingNote || videoState!=='idle';
  $('shutter').disabled=loadingPhoto || openingNote || videoState==='finishing';
}
function resumeCamera() {
  if(!document.hidden && activeScreen==='camera' && videoState==='idle' && !loadingPhoto && !openingNote && !picking && !document.querySelector('dialog[open]')) camera.start();
}

function notify(message,error=false) {
  clearTimeout(toastTimer);
  // Dialogs occupy the browser top layer, so place notices inside the active dialog too.
  document.querySelector('.inline-notice')?.remove();
  const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);
  if(dialog) {
    const el=document.createElement('p');el.className='inline-notice';el.setAttribute('role','status');el.textContent=message;
    const heading=dialog.querySelector('.dialog-top');if(heading)heading.after(el);else dialog.prepend(el);
  }
  $('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},6500);
}
function report(error) {
  const message=error?.name==='QuotaExceededError'?'Storage is full. Your photo is still open; download it or back up the note before closing.':
    error?.name==='SecurityError'?'Storage unavailable. Use a regular Safari window and keep a copy of the photo.':
      error?.message || 'Something went wrong. Please try again.';
  notify(message,true);
}
function confirmAction(title,message,label='Continue') {
  return new Promise(resolve=>{
    $('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-yes').textContent=label;
    const finish=result=>{$('confirm-dialog').close();resolve(result);};
    $('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);
    $('confirm-dialog').oncancel=e=>{e.preventDefault();finish(false);};
    $('confirm-dialog').showModal();$('confirm-no').focus();
  });
}
function markDirty() {
  revision++;dirty=true;$('save-status').textContent='Saving draft…';$('save-status').classList.remove('save-error');
  $('discard-draft').hidden=false;scheduleDraft();
}
function scheduleDraft(){
  clearTimeout(draftTimer);
  if(!draft || !dirty)return;
  draftTimer=setTimeout(()=>{if(!busy)flushDraft().catch(()=>{});},600);
}
async function flushDraft(){
  clearTimeout(draftTimer);
  if(!draft || !dirty || revision===lastDraftRevision)return;
  const session=draftSession,snapshot=readDraft(),snapshotRevision=revision;
  try{
    requirePersistence();await session.persist(snapshot,saved);
    if(session!==draftSession)return;
    lastDraftRevision=Math.max(lastDraftRevision,snapshotRevision);
    if(lastDraftRevision===revision){$('save-status').textContent='Draft saved on this device';$('save-status').classList.remove('save-error');}
  }catch(error){
    if(session===draftSession){$('save-status').textContent='Draft not saved · try again';$('save-status').classList.add('save-error');}
    throw error;
  }
}
async function refreshDrafts(){
  if(storageStartupError)return;
  const generation=++draftListGeneration,items=await listDrafts();
  if(generation!==draftListGeneration)return;
  recoverableDrafts=items;draftThumbnails.forEach(URL.revokeObjectURL);draftThumbnails=[];
  $('drafts-section').hidden=!items.length;$('resume-draft').hidden=!items.length;
  $('resume-draft').textContent=items.length>1?`Resume latest draft · ${items.length} drafts`:'Resume draft';
  $('draft-count').textContent=String(items.length);$('drafts-list').replaceChildren();
  for(const item of items){
    const card=document.createElement('article');card.className='draft-card';
    const open=document.createElement('button');open.className='draft-open';
    const img=document.createElement('img');img.alt='';const url=URL.createObjectURL(item.record.thumbnail);draftThumbnails.push(url);img.src=url;
    const body=document.createElement('span'),title=document.createElement('strong'),description=document.createElement('span'),meta=document.createElement('small');
    title.dir=description.dir='auto';title.textContent=item.record.project || 'Field note';description.textContent=item.record.description || 'No description';
    meta.textContent=`${item.saved?'Unsaved edits':'New note'} · ${formatDate(item.updatedAt)}`;body.append(title,description,meta);open.append(img,body);
    open.onclick=()=>openNote(item.record,item.saved,'Recovered draft',item).catch(report);
    const discard=document.createElement('button');discard.className='draft-discard icon-button';discard.setAttribute('aria-label',`Discard draft: ${item.record.description || item.record.project || 'Field note'}`);
    discard.innerHTML='<svg aria-hidden="true"><use href="#i-trash"/></svg>';
    discard.onclick=async()=>{
      if(!await confirmAction('Discard this draft?',item.saved?'Your saved note will stay unchanged.':'This unfinished photo and note will be removed.','Discard draft'))return;
      discard.disabled=true;
      try{requirePersistence();await deleteDraft(item.id,item.version);await refreshDrafts();}catch(error){report(error);}finally{discard.disabled=false;}
    };
    card.append(open,discard);$('drafts-list').append(card);
  }
}
function readDraft() {
  const photos=draft.photos.map((photo,index)=>({...photo,crop:{...photo.crop},annotations:index===activePhotoIndex && !isVideo(photo)?editor.committedAnnotations():structuredClone(photo.annotations)}));
  return {...draft,description:$('description').value.trim(),project:$('project').value.trim(),
    address:{area:$('area').value.trim(),block:$('block').value.trim(),street:$('street').value.trim()},
    photos,original:photos[0].original,thumbnail:photos[0].thumbnail,annotations:photos[0].annotations,crop:photos[0].crop,category:$('category').value,
    categoryName:$('category').value?categories.label($('category').value):''};
}
function currentPhoto(){return draft?.photos[activePhotoIndex];}
function attachmentSummary(items){
  const videos=items.filter(isVideo).length,photos=items.length-videos;
  return [photos&&`${photos} ${photos===1?'photo':'photos'}`,videos&&`${videos} ${videos===1?'video':'videos'}`].filter(Boolean).join(' · ');
}
function clearVideoPreview(){
  const player=$('note-video');player.pause();player.removeAttribute('src');player.removeAttribute('poster');player.load();player.hidden=true;
  videoURLs.forEach(URL.revokeObjectURL);videoURLs=[];
}
async function loadAttachment(item){
  cancelPhotoPreparation();
  await renderQueue;
  clearVideoPreview();
  if(isVideo(item)){
    editor.clear();const player=$('note-video');
    const src=URL.createObjectURL(item.original),poster=URL.createObjectURL(item.thumbnail);videoURLs=[src,poster];
    player.src=src;player.poster=poster;player.hidden=false;$('edit-canvas').hidden=true;
    player.onerror=()=>{if(player.getAttribute('src')===src)notify('This browser could not play this video. Save the original to open it in another app.',true);};
  }else{ $('edit-canvas').hidden=false;await editor.load(item.original,item.annotations,{sourceMaxSide:1600}); }
}
function photoRecord(record,photo){return {...record,...photo,id:record.id,photos:undefined};}
function renderPhotoRail(){
  photoURLs.forEach(URL.revokeObjectURL);photoURLs=[];$('photo-thumbnails').replaceChildren();
  if(!draft)return;
  for(const [index,photo] of draft.photos.entries()){
    const button=document.createElement('button');button.type='button';button.className='photo-thumbnail';button.dataset.photoIndex=index;
    button.setAttribute('aria-label',`${isVideo(photo)?'Video':'Photo'} ${index+1} of ${draft.photos.length}`);button.setAttribute('aria-pressed',String(index===activePhotoIndex));button.disabled=busy;
    const img=document.createElement('img');img.alt='';const url=URL.createObjectURL(photo.thumbnail);photoURLs.push(url);img.src=url;
    const label=document.createElement('span');label.textContent=isVideo(photo)?`▶ ${Math.ceil(photo.duration)}s`:String(index+1);button.append(img,label);
    button.onclick=()=>switchPhoto(index).catch(report);$('photo-thumbnails').append(button);
  }
  $('remove-photo').hidden=draft.photos.length===1;$('remove-photo').disabled=busy;
  $('add-photo').disabled=busy || draft.photos.length>=MAX_NOTE_PHOTOS;
  $('remove-photo').setAttribute('aria-label',isVideo(currentPhoto())?'Remove current video':'Remove current photo');
  $('note-title').textContent=draft.photos.length>1?`Edit note · ${attachmentSummary(draft.photos)}`:'Edit note';
}
async function switchPhoto(index){
  if(busy || !draft || index===activePhotoIndex || !draft.photos[index])return;
  hidePhotoText();editor.cancelGesture();draft=readDraft();setBusy(true);
  try{await loadAttachment(draft.photos[index]);activePhotoIndex=index;selectEditorView(editorView);syncPhotoRatio();renderPhotoRail();queuePrepare();}
  finally{setBusy(false);}
}
async function appendPhotos(files){
  if(busy || !draft || !files.length)return;
  if(draft.photos.length+files.length>MAX_NOTE_PHOTOS)throw new Error('A note can contain up to 10 photos and videos.');
  if(draft.photos.reduce((n,p)=>n+p.original.size,0)+files.reduce((n,p)=>n+p.size,0)>MAX_NOTE_BYTES)throw new Error('Keep the original files in one note below 100 MB.');
  for(const file of files)if(!file.type.startsWith('video/'))validatePhotoFile(file);
  hidePhotoText();editor.cancelGesture();draft=readDraft();setBusy(true);
  const temporary=new PhotoEditor(document.createElement('canvas'),()=>{},()=>'');
  try{
    cancelPhotoPreparation();
    await renderQueue;
    const added=[];
    for(const original of files){
      if(original.type.startsWith('video/'))added.push(await prepareVideo(original));
      else{
        await temporary.load(original,[],{sourceMaxSide:320,renderPreview:false});
        try{added.push({id:crypto.randomUUID(),original,thumbnail:await temporary.export(320,.8),annotations:[],crop:{ratio:'original'}});}
        finally{temporary.clear();}
      }
    }
    if($('data-status-dialog').open)return;
    const last=added.at(-1);await loadAttachment(last);
    draft.photos.push(...added);activePhotoIndex=draft.photos.length-1;selectEditorView('edit');syncPhotoRatio();renderPhotoRail();markDirty();
  }finally{temporary.clear();setBusy(false);queuePrepare();}
}
async function removeCurrentPhoto(){
  const type=isVideo(currentPhoto())?'video':'photo';
  if(busy || !draft || draft.photos.length<2 || !await confirmAction(`Remove this ${type}?`,'The other attachments and shared note will stay.',`Remove ${type}`))return;
  hidePhotoText();editor.cancelGesture();draft=readDraft();setBusy(true);
  try{
    const remaining=draft.photos.filter((_,i)=>i!==activePhotoIndex),index=Math.min(activePhotoIndex,remaining.length-1);
    await loadAttachment(remaining[index]);
    draft.photos=remaining;activePhotoIndex=index;selectEditorView(editorView);syncPhotoRatio();renderPhotoRail();markDirty();queuePrepare();
  }finally{setBusy(false);}
}
function resolveCategory(record) {
  return {...record,categoryName:record.category?categories.label(record.category,record.categoryName):''};
}
function seedCategories(records) {
  const previous=draft?categories.label($('category').value):'';
  categories.seed(records);refreshCategories();
  if(draft && previous!==categories.label($('category').value)){markDirty();queuePrepare();}
}
function refreshCategories() {
  const items=categories.list();
  for(const id of ['category','notes-category','default-category','phrase-category']) {
    const select=$(id),selected=id==='default-category'?categories.defaultId:select.value;
    select.replaceChildren();
    if(id==='notes-category')select.add(new Option('All categories','all'));
    select.add(new Option(id==='default-category'?'No default — Uncategorized':'Uncategorized',''));
    for(const item of items)select.add(new Option(item.name,item.id));
    select.value=[...select.options].some(option=>option.value===selected)?selected:(id==='notes-category'?'all':'');
  }
  renderPhraseSettings();if(nextCapture)syncNextCapture();
  $('category-list').replaceChildren();
  for(const item of items) {
    const row=document.createElement('div');row.className='managed-category';
    const name=document.createElement('span');name.dir='auto';name.textContent=item.name;
    const button=document.createElement('button');button.type='button';button.className='button button-plain';button.textContent='Edit';
    button.dataset.editCategory=item.id;button.setAttribute('aria-label',`Edit ${item.name}`);button.onclick=()=>openCategoryEditor(item.id);
    row.append(name,button);$('category-list').append(row);
  }
}
function openCategoryEditor(id='') {
  editingCategoryId=id;$('category-dialog-title').textContent=id?'Edit category':'New category';
  $('category-name').value=id?categories.label(id):'';$('category-error').textContent='';
  $('category-dialog').showModal();$('category-name').focus();
}
function readStamp() {
  return {mode:$('stamp-mode').value,address:Object.fromEntries(['area','block','street'].map(key=>[key,$(`stamp-address-${key}`).checked])),...Object.fromEntries(['date','time','location','note','project','category'].map(key=>[key,$(`stamp-${key}`).checked]))};
}
function photoSettingsSummary() {
  if(!draft)return 'No photo is open.';
  if(isVideo(currentPhoto()))return `Original video · ${Math.ceil(currentPhoto().duration)}s · ${draft.export.includeText?'Video + selected text':'Video only sharing'}`;
  const placement={strip:'Below photo',overlay:'On photo',off:'Photo only'}[draft.stamp.mode];
  return `${currentPhoto().crop.ratio==='original'?'Original':editor.width>=editor.height?'16:9':'9:16'} · ${placement} · ${draft.export.includeText?'Photos + selected text':'Photos only sharing'}`;
}
function readMessageFields() {return Object.fromEntries(Object.keys(MESSAGE_FIELDS).map(key=>[key,$(`message-${key}`).checked]));}
function syncMessagePreview() {
  $('message-options').disabled=!$('share-include-text').checked;
  $('message-preview').textContent=!$('share-include-text').checked?'Photo only. No message text will be attached.':!draft?'Open a photo to preview your selected message fields.':shareText({...readDraft(),export:{includeText:true,fields:readMessageFields()}}) || 'No message text selected for this photo.';
}
function syncPhotoRatio() {
  const video=isVideo(currentPhoto());$('photo-crop-controls').hidden=video;
  $('photo-ratio').value=currentPhoto().crop.ratio;
  $('photo-mode').textContent=video?`${currentPhoto().width} × ${currentPhoto().height} · Original video`:
    currentPhoto().crop.ratio==='original'?`${editor.width} × ${editor.height} · Original retained`:`${editor.width>=editor.height?'16:9':'9:16'} crop · Original retained`;
  $('download-photo').textContent=video?'Save video':'Save full-size JPEG';$('share-photo').textContent=video?'Share current video':'Share current photo';
  $('original-info').hidden=video;
  $('photo-settings-summary').textContent=photoSettingsSummary();
}
function syncSettingsActions() {
  $('current-photo-actions').hidden=!draft;
  $('apply-photo-wrap').hidden=!draft;
  $('current-photo-settings').textContent=photoSettingsSummary();
  $('current-photo-help').textContent=draft?(isVideo(currentPhoto())?'Video stays unchanged. Photo information and markup apply only to photographs.':'Export or back up the photo currently open in the editor.'):'Open a note to use these actions.';
  for(const button of document.querySelectorAll('[data-photo-action]'))button.disabled=!draft || busy;
  setShareButtons();
  $('photo-settings-summary').textContent=photoSettingsSummary();
}
function syncStampExample(){
  $('stamp-example').dataset.mode=$('stamp-mode').value;
  $('stamp-address').disabled=!$('stamp-location').checked || $('stamp-mode').value==='off';
  for(const input of document.querySelectorAll('.stamp-section input'))input.disabled=$('stamp-mode').value==='off';
}
function syncTheme(){
  const theme=preferences.value.theme || 'dark';
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f1f3f2':'#10171b';
  for(const button of document.querySelectorAll('[data-theme-choice]'))button.setAttribute('aria-pressed',String(button.dataset.themeChoice===theme));
}
function openSettings() {
  if(videoState!=='idle')return;
  reports.invalidateSetup();
  camera.stop();
  refreshCategories();
  const value=preferences.snapshot();$('stamp-mode').value=value.stamp.mode;
  for(const key of ['area','block','street'])$(`stamp-address-${key}`).checked=value.stamp.address?.[key]??true;
  for(const key of ['date','time','location','note','project','category'])$(`stamp-${key}`).checked=!!value.stamp[key];
  $('share-include-text').checked=value.export.includeText;$('auto-address').checked=value.autoAddress;
  for(const key of Object.keys(MESSAGE_FIELDS))$(`message-${key}`).checked=value.export.fields[key];
  syncMessagePreview();
  $('settings-status').textContent='Saved on this device';syncTheme();syncStampExample();syncSettingsActions();
  $('settings-dialog').showModal();$('settings-content')?.scrollTo(0,0);$('close-settings').focus({preventScroll:true});
}
function saveSettings() {
  const before=preferences.snapshot();
  try {preferences.save({stamp:readStamp(),export:{includeText:$('share-include-text').checked,fields:readMessageFields()},autoAddress:$('auto-address').checked,theme:preferences.value.theme});$('settings-status').textContent='Saved for new photos';}
  catch(error){$('settings-status').textContent=error.message;}
  const after=preferences.snapshot();
  syncMessagePreview();syncStampExample();
  if(before.autoAddress!==after.autoAddress && draft) {
    addressController?.abort();
    if(after.autoAddress && draft.location)lookupAddress();
    else $('address-status').textContent=after.autoAddress?'Address will follow GPS.':'Automatic address is off. Enter the address manually.';
  }
}
function refreshProjects() {
  for(const id of ['active-project','project']) {
    const select=$(id),selected=id==='project' && draft?select.value:(nextCapture?.project ?? projects.active);
    select.replaceChildren(new Option('No project', ''));
    for(const name of projects.names)select.add(new Option(name,name));
    select.value=selected;
  }
  $('finder-project').textContent=(nextCapture?.project ?? projects.active) || 'FIELD NOTES';
}
function selectProject(name) {try{projects.select(name);}catch(error){report(error);}if(nextCapture)nextCapture.project=projects.active;refreshProjects();}
function syncNextCapture() {
  $('next-note-banner').hidden=!nextCapture;
  $('next-note-category').textContent=nextCapture?categories.label(nextCapture.category):'';
  $('shutter-label').textContent=nextCapture?'NEXT PHOTO':'PHOTO';
  $('camera-hint').textContent=nextCapture?'Saved. Tap for photo · hold for video.':'Tap for photo · hold for video';
}
function openProject(target) {
  projectTarget=target;camera.stop();$('project-name').value='';$('project-dialog').showModal();$('project-name').focus();
}
function setBusy(value) {
  busy=value;
  for(const el of $('note-dialog').querySelectorAll('button,input,textarea,select')) el.disabled=value;
  $('edit-canvas').style.pointerEvents=value?'none':'';
  for(const button of document.querySelectorAll('[data-photo-action]'))button.disabled=value || !draft;
  if(!value){setShareButtons();if(draft){$('add-photo').disabled=draft.photos.length>=MAX_NOTE_PHOTOS;}if(dirty && revision!==lastDraftRevision)scheduleDraft();}
}
function setShareButtons() {
  const disabled=busy || !draft || (!prepared && draft.photos.length===1);
  for(const id of ['share-button','share-photo','download-photo']) $(id).disabled=disabled;
}
function cancelPhotoPreparation(){
  prepared=null;
  clearTimeout(prepareTimer);
  return ++exportGeneration;
}
async function prepareFiles(record,indices,isCurrent,onProgress=()=>{}){
  const files=[];
  const renderer=new PhotoEditor(document.createElement('canvas'),()=>{},()=>'');
  for(const index of indices){
    if(!isCurrent())return;
    const photo=record.photos[index];
    let blob=photo.original;
    if(!isVideo(photo)){
      try{
        await renderer.load(photo.original,photo.annotations,{renderPreview:false});
        if(!isCurrent())return;
        renderer.setRecord(photoRecord(record,photo),{renderPreview:false});
        blob=await renderer.export();
      }finally{renderer.clear();}
    }
    if(!isCurrent())return;
    const suffix=record.photos.length>1?`-${index+1}` : '';
    files.push(new File([blob],`rasd-${record.id}${suffix}.${mediaExtension(blob)}`,{type:blob.type.split(';')[0]}));
    onProgress(files.length);
    if(files.length<indices.length)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return files;
}
function queuePrepare() {
  if(!draft)return;
  const generation=cancelPhotoPreparation(),record=readDraft(),photo=record.photos[activePhotoIndex];
  const status=$('export-status');
  setShareButtons();
  try{if(!isVideo(photo))editor.setRecord(photoRecord(record,photo));}
  catch(error){status.textContent=error.message;return;}
  if(record.photos.length>1){status.textContent='Files are prepared when you share or export.';return;}
  status.textContent=isVideo(photo)?'Preparing original video…':'Preparing full-size JPEG…';
  const isCurrent=()=>generation===exportGeneration && !!draft && !$('data-status-dialog').open;
  prepareTimer=setTimeout(()=>{
    renderQueue=renderQueue.then(async()=>{
      if(!isCurrent())return;
      try{
        const files=await prepareFiles(record,[0],isCurrent);
        if(!files || !isCurrent())return;
        [prepared]=files;
        const frame=isVideo(photo)?photo:editor.frame();
        status.textContent=`${frame.width} × ${frame.height} · ${isVideo(photo)?'Original video':'JPEG'} · ${(prepared.size/1024/1024).toFixed(1)} MB`;
        setShareButtons();
      }catch(error){if(isCurrent()){status.textContent=error.message;report(error);}}
    });
  },400);
}
function showLocation(message) {
  const location=draft?.location;
  $('location-status').classList.toggle('has-location',!!location);
  $('location-status').textContent=message || (location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)} · accuracy ±${Math.round(location.accuracy)} m`:'No GPS location saved for this note.');
  $('map-link').hidden=!location;$('map-link').href=mapsURL(location) || '#';
}
async function lookupAddress() {
  addressController?.abort();
  if(!draft?.location)return;
  if(!preferences.snapshot().autoAddress){$('address-status').textContent='Automatic address is off. Enter the address manually.';return;}
  const controller=new AbortController();addressController=controller;
  const id=draft.id,generation=locationGeneration,point={...draft.location};
  $('address-status').textContent='Looking up area, block and street… You can keep editing.';
  try {
    const address=await addressLookup.lookup(point,{signal:controller.signal});
    if(controller.signal.aborted || !draft || draft.id!==id || generation!==locationGeneration)return;
    let changed=false;
    for(const key of ['area','block','street']) {
      if(!addressLocks.has(key) && $(key).value!==address[key]){$(key).value=address[key];changed=true;}
    }
    const missing=['area','block','street'].filter(key=>!$(key).value.trim());
    $('address-status').textContent=missing.length?`Nearby address found. Add ${missing.join(', ')} manually. Check all fields before sharing.`:'Nearby address added. Check the fields before sharing. Manual edits were kept.';
    if(changed){markDirty();queuePrepare();}
  } catch(error) {
    if(controller.signal.aborted || !draft || draft.id!==id || generation!==locationGeneration)return;
    $('address-status').textContent=error.message;
  }
}
function locate() {
  if(!draft || !navigator.geolocation) {showLocation('Location unavailable. Enter the address manually.');return;}
  const id=draft.id,generation=++locationGeneration;
  addressController?.abort();$('address-status').textContent='Address will follow GPS. Manual fields stay editable.';
  $('refresh-location').disabled=true;showLocation('Finding your location… You can keep editing.');
  navigator.geolocation.getCurrentPosition(position=>{
    if(!draft || draft.id!==id || generation!==locationGeneration) return;
    draft.location={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,timestamp:new Date(position.timestamp).toISOString()};
    for(const key of ['area','block','street'])if(!addressLocks.has(key))$(key).value='';
    $('refresh-location').disabled=busy;showLocation();markDirty();queuePrepare();
    $('camera-location').textContent=`Last GPS accuracy ±${Math.round(position.coords.accuracy)} m`;
    lookupAddress();
  },error=>{
    if(!draft || draft.id!==id || generation!==locationGeneration) return;
    $('refresh-location').disabled=busy;
    const message=error.code===1?'Location permission denied. Enable it in site settings or enter the address.':'No accurate location yet. Try again outdoors.';
    showLocation(draft.location?`${message} Your previously saved location is unchanged.`:message);
    $('address-status').textContent='Enter the address manually, or retry GPS.';
  },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
}
async function openNote(record,isSaved,mode='',recovery=null) {
  if(openingNote || draft || $('data-status-dialog').open) return;
  openingNote=true;syncAcquisitionControls();
  camera.stop();
  try {
  if(isSaved && !recovery && !storageStartupError){
    recovery=(await listDrafts()).find(item=>item.id===record.id) || null;
    if(recovery){record=recovery.record;mode='Recovered draft';}
  }
  if($('data-status-dialog').open)return;
  seedCategories([record]);record=resolveCategory(record);
  const first=photosOf(record)[0];
  await loadAttachment(first);
  if(!first.thumbnail)first.thumbnail=await editor.export(320,0.8);
  // A restore can finish in another window while the picker/decode is pending.
  if($('data-status-dialog').open){editor.clear();clearVideoPreview();return;}
  record={...record,photos:photosOf(record),original:first.original,thumbnail:first.thumbnail,annotations:first.annotations,crop:first.crop};record.photos[0]=first;
  camera.stop();
  activePhotoIndex=0;textEditing=false;textPoint=null;
  draft={...record,photos:photosOf(record),stamp:normalizeStamp(record.stamp),export:normalizeExport(record.export),crop:normalizeCrop(record.crop),category:record.category || ''};saved=isSaved;dirty=!!recovery || !isSaved;revision=0;prepared=null;locationGeneration++;
  draftSession=new DraftSession(recovery);lastDraftRevision=recovery?0:-1;clearTimeout(draftTimer);
  addressController?.abort();addressLocks=new Set(isSaved || recovery?['area','block','street'].filter(key=>record.address[key]):[]);
  $('note-dialog').querySelector('.inline-notice')?.remove();
  $('description').value=record.description;
  $('category').value=draft.category;
  if(record.project && !projects.names.includes(record.project))projects.names.push(record.project);
  refreshProjects();$('project').value=record.project;
  for(const key of ['area','block','street']) $(key).value=record.address[key];
  $('annotation-text').value='';$('copy-fallback').hidden=true;
  $('note-state').textContent=isSaved?'FROM YOUR LIBRARY':'NEW FIELD NOTE';
  $('save-status').textContent=recovery?'Draft saved on this device':isSaved?'Saved on this device':'Saving draft…';
  $('save-status').classList.remove('save-error');$('discard-draft').hidden=!dirty;
  $('capture-time').textContent=`Date & time · ${formatDate(record.createdAt)}`;
  syncPhotoRatio();$('delete-note').hidden=!isSaved;
  $('source-label').textContent=mode || 'Saved original';
  $('address-status').textContent=isSaved?'Saved address. You can edit any field.':'Address will follow GPS.';
  $('photo-settings-summary').textContent=photoSettingsSummary();
  selectTool('select');selectEditorView('edit');showLocation();renderPhotoRail();
  $('note-dialog').showModal();$('note-dialog').scrollTop=0;
  $('note-form').scrollTop=0;$('editor-layout').scrollTop=0;$('note-form').querySelector('.gps-details').open=false;
  $('close-note').focus({preventScroll:true});
  queuePrepare();
  if(!isSaved && !recovery)locate();
  if(dirty && !recovery)flushDraft().catch(()=>{});
  } finally {openingNote=false;syncAcquisitionControls();}
}
function validatePhotoFile(blob){
  if(!blob || !blob.size || blob.size>MAX_PHOTO_BYTES) throw new Error('Choose a photo smaller than 25 MB. Your original has not been changed.');
  if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(blob.type))throw new Error('Choose JPEG, PNG, WebP or a browser-readable HEIC/HEIF photo.');
}
async function newPhoto(blob,mode) {
  const video=blob.type.startsWith('video/')?await prepareVideo(blob):null;
  if(!video)validatePhotoFile(blob);const defaults=preferences.snapshot();
  if($('data-status-dialog').open)return;
  const category=nextCapture?.category ?? categories.defaultId,project=nextCapture?.project ?? projects.active;
  await openNote({id:crypto.randomUUID(),createdAt:new Date().toISOString(),project,description:'',address:{area:'',block:'',street:''},location:null,original:blob,...(video?{photos:[video],thumbnail:video.thumbnail}:{}),annotations:[],category,categoryName:category?categories.label(category):'',stamp:defaults.stamp,export:defaults.export,crop:{ratio:'original'}},false,mode);
  if(draft){nextCapture=null;syncNextCapture();refreshProjects();}
}
async function closeNote() {
  if(busy) return;
  setBusy(true);
  try{while(dirty && revision!==lastDraftRevision)await flushDraft();}
  catch(error){report(error);return;}
  finally{setBusy(false);}
  finishCloseNote();
}
function finishCloseNote(){
  locationGeneration++;addressController?.abort();cancelPhotoPreparation();
  clearTimeout(draftTimer);draftSession=null;hidePhotoText();photoURLs.forEach(URL.revokeObjectURL);photoURLs=[];
  clearVideoPreview();
  $('note-dialog').close();draft=null;prepared=null;dirty=false;editor.clear();
  refreshDrafts().catch(report);
  if(activeScreen==='camera') resumeCamera(); else refreshArchive();
}
async function saveCurrent(event,next=false) {
  event?.preventDefault();if(busy || !draft) return;
  setBusy(true);let completed;
  try {
    do {
      const record=readDraft();
      const savedRevision=revision;
      requirePersistence();clearTimeout(draftTimer);await draftSession.commit(record,saved);
      // A GPS callback may have updated the draft while the transaction committed.
      draft={...record,location:draft.location};saved=true;dirty=revision!==savedRevision;$('delete-note').hidden=false;
      $('note-state').textContent='SAVED';
      $('save-status').textContent=dirty?'Location updated. Save once more to keep it.':'Saved on this device.';
      $('save-status').classList.remove('save-error');$('discard-draft').hidden=!dirty;lastDraftRevision=-1;
      completed=record;
      // A round may advance only after GPS/address updates received during save are durable too.
    } while(next && dirty);
    refreshDrafts().catch(report);
    navigator.storage?.persist?.().then(updateStorageInfo).catch(()=>{});
  } catch(error) {completed=null;report(error);} finally {setBusy(false);if(dirty)scheduleDraft();}
  if(next && completed && !dirty && !$('data-status-dialog').open) {
    nextCapture={project:completed.project,category:completed.category};syncNextCapture();refreshProjects();
    $('camera-location').textContent='GPS added after capture';
    switchScreen('camera');finishCloseNote();$('shutter').focus({preventScroll:true});
    notify('Note saved. Ready for the next photo.');
  }
}
function download(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function share(fileOnly=false,currentOnly=false) {
  if(!draft || busy)return;
  if(prepared)void shareFiles([prepared],fileOnly);
  else if(draft.photos.length>1)void prepareExport(currentOnly,fileOnly,false);
}
async function prepareExport(currentOnly,fileOnly,downloadOnly){
  const dialog=$('prepare-export-dialog'),status=$('prepare-export-status'),confirm=$('confirm-export');
  const record=readDraft(),generation=exportGeneration,request=++exportRequest;
  const indices=currentOnly?[activePhotoIndex]:record.photos.map((_,index)=>index);
  const isOpen=()=>dialog.open && request===exportRequest;
  const isCurrent=()=>isOpen() && draft?.id===record.id && generation===exportGeneration && !$('data-status-dialog').open;
  status.textContent=`Preparing ${indices.length} ${indices.length===1?'file':'files'}…`;
  confirm.hidden=true;
  confirm.onclick=null;
  $('prepare-export-title').textContent=downloadOnly?'Save file':'Share attachments';
  dialog.showModal();
  try{
    const job=renderQueue.then(()=>prepareFiles(record,indices,isCurrent,count=>{
      status.textContent=`Prepared ${count} of ${indices.length}`;
    }));
    renderQueue=job.catch(()=>{});
    const files=await job;
    if(!files || !isCurrent()){
      if(isOpen())status.textContent='Note details changed. Close and try again.';
      return;
    }
    status.textContent=`${files.length} ${files.length===1?'file':'files'} ready · ${(files.reduce((size,file)=>size+file.size,0)/1024/1024).toFixed(1)} MB`;
    confirm.textContent=downloadOnly?'Save':'Share';
    confirm.hidden=false;
    confirm.onclick=()=>{
      const current=isCurrent();
      dialog.close();
      if(!current){notify('Note details changed. Try exporting again.');return;}
      if(downloadOnly)download(files[0],files[0].name);
      else void shareFiles(files,fileOnly);
    };
  }catch(error){if(isCurrent())status.textContent=error.message;}
}
async function shareFiles(files,fileOnly) {
  const data={files},text=fileOnly?'':shareText(readDraft());if(text)data.text=text;
  try {
    if(!navigator.share || !navigator.canShare?.({files})){
      if(files.length>1){showShareFiles(data);return;}
      download(files[0],files[0].name);notify('File download is ready. Use Copy selected text to include the details.');return;
    }
    // The prepared files are shared directly from the tap for iOS activation.
    const sharing=navigator.share(data);
    setBusy(true);
    await sharing;
    notify('Share sheet closed. Check the files and note in WhatsApp.');
  }catch(error){
    if(error.name!=='AbortError')notify('Sharing failed. Try sharing the current attachment, then copy the note and map link.',true);
  }finally{setBusy(false);}
}
function selectTool(tool) {
  hidePhotoText();
  editor.setTool(tool);
  document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
  syncSelection();
}
function syncSelection(){
  const selected=editor.getSelected();
  $('markup-hint').hidden=isVideo(currentPhoto()) || editorView!=='edit';
  document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===editor.tool)));
  $('selection-actions').hidden=!selected || editorView!=='edit';
  if(textEditing && !textPoint && selected?.type!=='text')hidePhotoText();
  $('annotation-text-wrap').hidden=!textEditing || editorView!=='edit';
  $('markup-hint').textContent=editor.tool==='text'?'Tap the photo to add text':selected?.type==='text'?'Drag handles to resize · tap text again to edit':'Tap an item · drag handles to resize';
  if(selected?.type==='text' && (document.activeElement!==$('annotation-text') || selectedAnnotationIndex!==editor.selectedIndex))$('annotation-text').value=selected.text;
  selectedAnnotationIndex=editor.selectedIndex;
  document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===(selected?.color || editor.color))));
  if(textEditing)positionPhotoText();
}
function showPhotoText(shape,point){
  if(editorView!=='edit' || busy)return;
  textEditing=true;textPoint=shape?null:point;$('annotation-text').value=shape?.text || '';$('annotation-text-wrap').hidden=false;
  positionPhotoText();$('annotation-text').focus({preventScroll:true});
}
function hidePhotoText(){textEditing=false;textPoint=null;$('annotation-text-wrap').hidden=true;}
function positionPhotoText(){
  const canvas=$('edit-canvas').getBoundingClientRect(),stage=$('photo-stage').getBoundingClientRect(),crop=editor.frame();
  const bounds=editor.selectionRect?.(),point=textPoint?{left:(textPoint.x*editor.width-crop.x)/crop.width*canvas.width,top:(textPoint.y*editor.height-crop.y)/crop.height*canvas.height}:bounds || {left:canvas.width*.3,top:canvas.height*.4};
  const width=Math.min(280,Math.max(180,stage.width-24)),left=Math.max(8,Math.min(stage.width-width-8,canvas.left-stage.left+point.left));
  $('annotation-text-wrap').style.cssText=`width:${width}px;left:${left}px;top:${Math.max(4,Math.min(stage.height-52,canvas.top-stage.top+point.top))}px`;
}
function writePhotoText(event){
  if(event?.isComposing)return;
  const text=$('annotation-text').value;
  if(textPoint && text.trim()){const point=textPoint;if(editor.addTextAt(text,point))textPoint=null;}
  else if(editor.getSelected()?.type==='text')editor.updateSelectedText(text);
}
function renderPhraseSettings(){
  const category=$('phrase-category').value,items=phrases.list(category);$('phrase-list').replaceChildren();
  if(!items.length){const empty=document.createElement('p');empty.className='field-help';empty.textContent='No phrases yet.';$('phrase-list').append(empty);}
  for(const item of items){
    const row=document.createElement('div');row.className='managed-phrase';
    const text=document.createElement('p');text.dir='auto';text.textContent=item.text;
    const edit=document.createElement('button');edit.className='button button-plain';edit.textContent='Edit';edit.dataset.editPhrase=item.id;edit.onclick=()=>openPhraseEditor(item);
    const remove=document.createElement('button');remove.className='icon-button';remove.setAttribute('aria-label',`Delete phrase: ${item.text}`);remove.dataset.deletePhrase=item.id;remove.innerHTML='<svg aria-hidden="true"><use href="#i-trash"/></svg>';
    remove.onclick=async()=>{if(!await confirmAction('Delete phrase?','Existing notes will keep their text.','Delete phrase'))return;try{phrases.remove(item.id);renderPhraseSettings();}catch(error){report(error);}};
    row.append(text,edit,remove);$('phrase-list').append(row);
  }
}
function openPhraseEditor(item=null){
  editingPhraseId=item?.id || '';$('phrase-dialog-title').textContent=item?'Edit phrase':'New phrase';$('phrase-text').value=item?.text || '';$('phrase-error').textContent='';$('phrase-dialog').showModal();$('phrase-text').focus();
}
function openPhrasePicker(){
  if(!draft)return;
  const choices=$('phrase-choices');
  choices.replaceChildren();
  for(const category of [{id:'',name:'Uncategorized'},...categories.list()]){
    const entries=phrases.list(category.id);
    if(!entries.length)continue;
    const heading=document.createElement('h3');
    heading.dir='auto';heading.textContent=category.name;choices.append(heading);
    for(const phrase of entries){
      const button=document.createElement('button');
      button.className='phrase-choice';button.dir='auto';button.textContent=phrase.text;
      button.onclick=()=>{
        const field=$('description'),before=field.value.trimEnd(),after=before?`${before}\n${phrase.text}`:phrase.text;
        if(after.length>4000){notify('The note is full. Shorten it before adding a phrase.',true);return;}
        $('category').value=phrase.category;
        field.value=after;markDirty();queuePrepare();$('phrase-picker-dialog').close();field.focus();
      };
      choices.append(button);
    }
  }
  if(!choices.childElementCount){
    const empty=document.createElement('p');empty.className='field-help';empty.textContent='Add phrases in Settings → Quick phrases.';choices.append(empty);
  }
  $('phrase-picker-dialog').showModal();
}
function showShareFiles(data){
  $('share-files-list').replaceChildren();
  for(const [index,file] of data.files.entries()){
    const row=document.createElement('div');row.className='share-file-row';const label=document.createElement('span');label.textContent=`${file.type.startsWith('video/')?'Video':'Photo'} ${index+1}`;
    const save=document.createElement('button');save.className='button button-secondary';save.textContent='Save';save.onclick=()=>download(file,file.name);
    row.append(label,save);
    if(navigator.canShare?.({files:[file]})){
      const button=document.createElement('button');button.className='button button-primary';button.textContent='Share';
      button.onclick=async()=>{try{await navigator.share({files:[file],...(data.text?{text:data.text}:{})});}catch(error){if(error.name!=='AbortError')report(error);}};row.append(button);
    }
    $('share-files-list').append(row);
  }
  $('share-files-dialog').showModal();
}
function selectEditorView(view) {
  hidePhotoText();
  editorView=view;editor.setView(view==='edit'?'markup':'preview');
  $('note-form').hidden=view==='preview';
  $('annotation-tools').hidden=view!=='edit' || isVideo(currentPhoto());
  $('annotation-options').hidden=view!=='edit' || isVideo(currentPhoto());syncSelection();
  $('editor-layout').dataset.view=view;
  $('editor-layout').setAttribute('aria-labelledby',`tab-${view}`);
  $('editor-layout').scrollTop=0;
  $('edit-canvas').setAttribute('aria-label',view==='preview'?'Export preview':'Photo annotation canvas: draw or use Select to move an annotation');
  document.querySelectorAll('[data-editor-view]').forEach(button=>{
    const selected=button.dataset.editorView===view;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  });
}
async function refreshArchive() {
  try {
    await refreshDrafts();
    notes=await listNotes();
    seedCategories(notes);
    const filter=$('notes-project'),selected=filter.value;
    filter.replaceChildren(new Option('All projects',''));
    for(const name of [...new Set(notes.map(note=>note.project))].sort((a,b)=>a.localeCompare(b)))filter.add(new Option(name || 'No project',`project:${name}`));
    filter.value=[...filter.options].some(option=>option.value===selected)?selected:'';
    renderArchive();updateStorageInfo();
  } catch(error) {report(error);}
}
function renderArchive() {
  thumbnails.forEach(URL.revokeObjectURL);thumbnails=[];$('notes-list').replaceChildren();
  const selected=$('notes-project').value;
  const category=$('notes-category').value;
  const view=libraryView(notes.map(resolveCategory),{query:$('search').value,project:selected?selected.slice(8):null,category:category==='all'?null:category,sort:$('notes-sort').value});
  reports.sync(notes.map(resolveCategory),view.groups.flatMap(group=>group.notes));
  const filters=Number(!!selected)+Number(category!=='all')+Number($('notes-sort').value!=='newest');
  $('filter-count').textContent=filters?String(filters):'';
  $('filter-count').hidden=!filters;
  $('note-count').textContent=`${view.count} ${view.count===1?'note':'notes'}`;
  $('library-summary').textContent=selected?`${view.count} of ${notes.length} notes · ${selected.slice(8) || 'No project'}`:`${notes.length} ${notes.length===1?'note':'notes'} · stored on this device`;
  $('archive-empty').hidden=notes.length!==0;$('search-empty').hidden=notes.length===0 || view.count!==0;
  for(const group of view.groups) {
    const section=document.createElement('section');section.className='note-day';
    const heading=document.createElement('h2');heading.className='day-heading';heading.textContent=group.label;
    const count=document.createElement('span');count.textContent=String(group.notes.length);heading.append(count);section.append(heading);
    for(const note of group.notes) {
    const card=document.createElement('article');card.className='note-card';
    const open=document.createElement('button');open.className='note-open';
    const img=document.createElement('img');img.alt='';img.loading='lazy';
    const url=URL.createObjectURL(note.thumbnail);thumbnails.push(url);img.src=url;
    const body=document.createElement('div');body.className='note-card-body';
    const title=document.createElement('h3');title.dir='auto';title.textContent=note.project || 'No project';
    const desc=document.createElement('p');desc.dir='auto';desc.textContent=note.description || 'No description';
    const meta=document.createElement('small');meta.dir='auto';meta.textContent=[photosOf(note).length>1 || photosOf(note).some(isVideo)?attachmentSummary(photosOf(note)):'',noteTime(note.createdAt),note.address.area,note.address.block && `Block ${note.address.block}`].filter(Boolean).join(' · ');
    const badge=document.createElement('span');badge.className='category-badge';badge.dir='auto';badge.textContent=categoryLabel(note.category,note.categoryName);
    body.append(title,badge,desc,meta);open.append(img,body);
    open.onclick=()=>openNote(structuredClone(note),true).catch(report);
    const actions=document.createElement('button');actions.className='note-more icon-button';actions.setAttribute('aria-label',`Actions for ${note.project || 'note'} at ${noteTime(note.createdAt)}`);actions.setAttribute('aria-haspopup','dialog');actions.textContent='•••';
    actions.onclick=()=>{
      libraryActionNote=note;$('library-note-title').textContent=note.project || 'Field note';$('library-note-description').textContent=note.description || 'No description';
      $('note-actions-dialog').showModal();
    };
    card.append(open,actions);reports.decorate(card,open,actions,note);section.append(card);
    }
    $('notes-list').append(section);
  }
}
async function updateStorageInfo() {
  try {
    const persistent=await navigator.storage?.persisted?.();
    const size=notes.reduce((n,r)=>n+photosOf(r).reduce((sum,p)=>sum+p.original.size+p.thumbnail.size,0),0);
    $('storage-note').textContent=`${(size/1024/1024).toFixed(1)} MB on this device · ${persistent?'Persistent storage enabled.':'Keep a backup.'}`;
  } catch { /* Backup reminder remains visible when storage estimates are unavailable. */ }
}
function switchScreen(screen) {
  if(loadingPhoto || openingNote || videoState!=='idle') return;
  activeScreen=screen;$('camera-screen').hidden=screen!=='camera';$('archive-screen').hidden=screen!=='archive';
  for(const name of ['camera','archive']) {if(name===screen) $(`nav-${name}`).setAttribute('aria-current','page');else $(`nav-${name}`).removeAttribute('aria-current');}
  if(screen==='camera') {if(reports.mode)reports.setMode(false);resumeCamera();}
  else {camera.stop();refreshArchive();}
}
function pickPhoto(input) {
  if(loadingPhoto || openingNote || draft || videoState!=='idle' || $('data-status-dialog').open) return;
  picking=true;camera.stop();$('shutter').disabled=true;$('camera-placeholder').hidden=false;
  $('camera-message').textContent=input==='native-video-input'?'Record a video up to 1 minute, then use it here.':'Use your phone camera or choose a photo or video.';$('restart-camera').disabled=false;
  $(input).value='';$(input).click();
}
async function exportRecords(records) {
  const content=await encodeBackup(records.map(resolveCategory));
  download(new Blob([content],{type:'application/json'}),`rasd-backup-${new Date().toISOString().slice(0,10)}.json`);
  notify('Save the backup to Files or iCloud Drive.');
}

$('restart-camera').onclick=()=>{picking=false;resumeCamera();};
$('add-photo').onclick=()=>{if(draft && !busy)$('add-photos-dialog').showModal();};
$('close-add-photos').onclick=()=>$('add-photos-dialog').close();
for(const [button,input] of [['add-from-camera','add-photo-camera'],['add-from-video','add-video-camera'],['add-from-library','add-photo-library']])$(button).onclick=()=>{$('add-photos-dialog').close();$(input).value='';$(input).click();};
for(const id of ['add-photo-camera','add-video-camera','add-photo-library'])$(id).onchange=async event=>{const files=[...event.target.files];try{await appendPhotos(files);}catch(error){report(error);}finally{event.target.value='';}};
$('remove-photo').onclick=()=>removeCurrentPhoto().catch(report);
$('quick-phrases').onclick=openPhrasePicker;$('close-phrase-picker').onclick=()=>$('phrase-picker-dialog').close();
$('phrase-category').onchange=renderPhraseSettings;$('phrase-add').onclick=()=>openPhraseEditor();$('cancel-phrase').onclick=()=>$('phrase-dialog').close();
$('phrase-form').onsubmit=event=>{event.preventDefault();try{if(editingPhraseId)phrases.edit(editingPhraseId,$('phrase-text').value);else phrases.add($('phrase-category').value,$('phrase-text').value);renderPhraseSettings();$('phrase-dialog').close();$('settings-status').textContent='Phrases saved on this device';}catch(error){$('phrase-error').textContent=error.message;}};
$('close-prepare-export').onclick=()=>$('prepare-export-dialog').close();
$('prepare-export-dialog').onclose=()=>{
  if(!$('prepare-export-dialog').open)$('confirm-export').onclick=null;
};
$('close-share-files').onclick=()=>$('share-files-dialog').close();
$('resume-draft').onclick=()=>{const item=recoverableDrafts[0];if(item)openNote(item.record,item.saved,'Recovered draft',item).catch(report);};
videoCapture=new HoldVideoCapture($('shutter'),{
  getStream:()=>camera.stream,
  canStart:()=>!loadingPhoto && !openingNote && !picking && !draft && activeScreen==='camera' && !document.hidden && !document.querySelector('dialog[open]'),
  onPhoto:()=>pickPhoto('native-input'),
  onVideo:async blob=>{
    if($('data-status-dialog').open)return;
    loadingPhoto=true;syncAcquisitionControls();
    try{await newPhoto(blob,'Recorded video');}finally{loadingPhoto=false;syncAcquisitionControls();}
  },
  onState:({status,elapsed})=>{
    videoState=status;$('shutter').classList.toggle('is-recording',status==='recording');
    $('recording-status').hidden=status==='idle';
    $('recording-status').textContent=status==='requesting'?'Allow microphone to record':status==='finishing'?'Preparing video…':`REC ${Math.floor((elapsed || 0)/60)}:${String(Math.floor((elapsed || 0)%60)).padStart(2,'0')}`;
    if(status==='idle'){syncNextCapture();if(!draft && !camera.stream)resumeCamera();}
    else $('shutter-label').textContent=status==='recording'?'RELEASE TO STOP':'VIDEO';
    syncAcquisitionControls();
  },
  onError:report
});
$('record-video').onclick=()=>pickPhoto('native-video-input');
$('end-round').onclick=()=>{nextCapture=null;syncNextCapture();refreshProjects();};
$('open-notes').onclick=()=>switchScreen('archive');$('choose-photo').onclick=()=>pickPhoto('photo-input');
for(const id of ['native-input','native-video-input','photo-input']) {
  $(id).addEventListener('cancel',()=>{picking=false;resumeCamera();});
  $(id).onchange=async event=>{
    picking=false;const file=event.target.files[0];if(!file){resumeCamera();return;}
    if(loadingPhoto || openingNote || draft || $('data-status-dialog').open)return;
    loadingPhoto=true;syncAcquisitionControls();$('camera-message').textContent='Opening your photo…';
    try {await newPhoto(file,id==='native-input'?'Phone camera':id==='native-video-input'?'Phone video camera':file.type.startsWith('video/')?'Imported video · added now':'Imported photo · added now');}catch(error){report(error);}
    finally {loadingPhoto=false;syncAcquisitionControls();if(!draft)resumeCamera();}
  };
}
$('nav-camera').onclick=()=>switchScreen('camera');$('nav-archive').onclick=()=>switchScreen('archive');$('empty-capture').onclick=()=>switchScreen('camera');
$('library-new').onclick=()=>{switchScreen('camera');pickPhoto('native-input');};
$('library-tools').onclick=()=>{reports.invalidateSetup();$('library-tools-dialog').showModal();};
$('close-library-tools').onclick=()=>$('library-tools-dialog').close();
$('close-note-actions').onclick=()=>$('note-actions-dialog').close();
$('library-note-edit').onclick=()=>{
  if(!libraryActionNote)return;
  const record=structuredClone(libraryActionNote);$('note-actions-dialog').close();openNote(record,true).catch(report);
};
$('library-note-delete').onclick=async()=>{
  const record=libraryActionNote;if(!record)return;
  if(!await confirmAction('Delete this note?','The photo and note will be removed from this device. A backup is needed to restore them.','Delete'))return;
  $('library-note-delete').disabled=true;
  try {requirePersistence();await deleteNote(record.id);$('note-actions-dialog').close();libraryActionNote=null;await refreshArchive();$('library-tools').focus();notify('Note deleted.');}
  catch(error){report(error);}finally{$('library-note-delete').disabled=false;}
};
$('notes-project').onchange=renderArchive;$('notes-sort').onchange=renderArchive;$('notes-category').onchange=renderArchive;
$('clear-filters').onclick=()=>{$('search').value='';$('notes-project').value='';$('notes-category').value='all';renderArchive();};
const editorTabs=[...document.querySelectorAll('[data-editor-view]')];
for(const [index,tab] of editorTabs.entries()) {
  tab.onclick=()=>selectEditorView(tab.dataset.editorView);
  tab.onkeydown=event=>{
    const next={ArrowRight:(index+1)%editorTabs.length,ArrowLeft:(index+editorTabs.length-1)%editorTabs.length,Home:0,End:editorTabs.length-1}[event.key];
    if(next===undefined)return;
    event.preventDefault();editorTabs[next].focus();selectEditorView(editorTabs[next].dataset.editorView);
  };
}
$('close-note').onclick=closeNote;$('note-dialog').oncancel=event=>{event.preventDefault();closeNote();};
$('note-form').onsubmit=saveCurrent;fields.forEach(id=>$(id).addEventListener('input',()=>{markDirty();queuePrepare();}));
$('save-next').onclick=event=>saveCurrent(event,true);
function revealFocusedField() {
  const field=document.activeElement;
  if(!$('note-dialog').open || !field?.matches('#note-form input,#note-form textarea,#note-form select,#annotation-text'))return;
  // Native focus may expose only the caret, leaving the rest behind the footer.
  requestAnimationFrame(()=>{if(document.activeElement===field)field.scrollIntoView({block:'nearest',inline:'nearest'});});
}
$('note-dialog').addEventListener('focusin',revealFocusedField);
window.addEventListener('resize',revealFocusedField);window.visualViewport?.addEventListener('resize',revealFocusedField);
for(const key of ['area','block','street'])$(key).addEventListener('input',()=>addressLocks.add(key));
$('project').addEventListener('change',()=>selectProject($('project').value));
$('active-project').onchange=()=>selectProject($('active-project').value);
$('add-project').onclick=()=>openProject('active-project');$('add-note-project').onclick=()=>openProject('project');
$('cancel-project').onclick=()=>$('project-dialog').close();$('project-dialog').onclose=resumeCamera;
$('project-form').onsubmit=event=>{
  event.preventDefault();const name=$('project-name').value.trim();if(!name)return;
  selectProject(name);$(projectTarget).value=name;
  if(projectTarget==='project'){markDirty();queuePrepare();}
  $('project-dialog').close();$(projectTarget).focus();
};
$('nav-settings').onclick=openSettings;$('note-settings').onclick=openSettings;
$('category-add').onclick=()=>openCategoryEditor();
$('cancel-category').onclick=()=>$('category-dialog').close();
$('category-form').onsubmit=event=>{
  event.preventDefault();
  try {
    const id=editingCategoryId;
    if(id)categories.rename(id,$('category-name').value);else categories.add($('category-name').value);
    refreshCategories();
    if(id && draft && $('category').value===id){markDirty();queuePrepare();}
    if(activeScreen==='archive')renderArchive();
    $('category-dialog').close();$('category-add').focus({preventScroll:true});
    $('settings-status').textContent=id?'Category name updated. Existing notes keep their category.':'Category added. Choose it below as the default if needed.';
  } catch(error){$('category-error').textContent=error.message;}
};
$('default-category').onchange=()=>{
  try {categories.setDefault($('default-category').value);$('settings-status').textContent='Default category saved for new notes.';}
  catch(error){$('default-category').value=categories.defaultId;$('settings-status').textContent=error.message;}
};
$('close-settings').onclick=()=>$('settings-dialog').close();$('settings-dialog').onclose=resumeCamera;
for(const button of document.querySelectorAll('[data-theme-choice]'))button.onclick=()=>{
  try{preferences.save({...preferences.snapshot(),theme:button.dataset.themeChoice});$('settings-status').textContent='Saved on this device';}
  catch(error){$('settings-status').textContent=error.message;}
  syncTheme();
};
$('settings-form').onchange=saveSettings;$('settings-form').onsubmit=event=>event.preventDefault();
$('photo-ratio').onchange=()=>{
  if(!draft || busy)return;
  currentPhoto().crop={ratio:$('photo-ratio').value};syncPhotoRatio();markDirty();queuePrepare();syncSettingsActions();
};
for(const [key,name] of Object.entries(MESSAGE_FIELDS)) {
  const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.id=`message-${key}`;input.checked=true;
  label.append(input,name);$('message-fields').append(label);
}
$('apply-photo-settings').onclick=()=>{
  if(!draft || busy)return;
  const value=preferences.snapshot();draft.stamp=value.stamp;draft.export=value.export;syncPhotoRatio();
  markDirty();queuePrepare();syncSettingsActions();$('settings-status').textContent='Applied to this note’s photos. Save the note to keep the change.';
};
$('refresh-location').onclick=locate;$('share-button').onclick=()=>share(!draft?.export.includeText);$('share-photo').onclick=()=>share(true,true);
$('download-photo').onclick=()=>{
  if(prepared)download(prepared,prepared.name);
  else if(draft?.photos.length>1)void prepareExport(true,true,true);
};
$('download-original').onclick=()=>{
  if(!draft)return;
  const extension=mediaExtension(currentPhoto().original);
  download(currentPhoto().original,`rasd-${draft.id}-original.${extension}`);
};
$('copy-text').onclick=async()=>{
  const text=shareText(readDraft());
  if(!text){$('copy-fallback').hidden=true;notify('No message text selected. Choose fields in Settings and apply them to this photo.');return;}
  try {await navigator.clipboard.writeText(text);notify('Selected text copied.');}
  catch {$('copy-fallback').value=text;$('copy-fallback').hidden=false;$('copy-fallback').focus();$('copy-fallback').select();notify('Select the text below and copy it.');}
};
document.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>selectTool(button.dataset.tool));
document.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{
  editor.setColor(button.dataset.color);syncSelection();
});
$('annotation-text').oninput=writePhotoText;$('annotation-text').oncompositionend=writePhotoText;
$('finish-photo-text').onclick=()=>{writePhotoText();hidePhotoText();};
$('annotation-delete').onclick=()=>editor.deleteSelected();
$('undo').onclick=()=>editor.undo();$('search').oninput=renderArchive;
$('discard-draft').onclick=async()=>{
  if(busy || !draft || !await confirmAction('Discard changes?',saved?'Your saved note will stay unchanged.':'This unfinished photo and note will be removed.','Discard changes'))return;
  setBusy(true);clearTimeout(draftTimer);
  try{await draftSession.discard(draft.id);finishCloseNote();notify('Draft discarded.');}
  catch(error){
    if(error.name==='DraftConflictError'){finishCloseNote();notify('Local changes discarded. The latest version in Notes was kept.');}
    else report(error);
  }finally{setBusy(false);}
};
$('delete-note').onclick=async()=>{
  if(busy || !draft || !await confirmAction('Delete this note?','The photo and note will be removed from this device. A backup is needed to restore them.','Delete'))return;
  setBusy(true);
  try {requirePersistence();clearTimeout(draftTimer);await draftSession.queue.catch(()=>{});await deleteNote(draft.id);finishCloseNote();notify('Note deleted.');}
  catch(error) {report(error);}finally{setBusy(false);}
};
$('backup-note').onclick=async()=>{
  if(busy || !draft)return;setBusy(true);
  try {await exportRecords([readDraft()]);}catch(error){report(error);}finally{setBusy(false);}
};
async function backUpEverything(){
  if(busy)return;
  if(dirty){notify('Save or close your current note before backing up everything.');return;}
  for(const id of ['backup-button','settings-backup'])$(id).disabled=true;
  try{
    requirePersistence();
    if((await listDrafts()).length){notify('Save or discard your drafts in Notes before backing up everything.');return;}
    const records=await listNotes();projects.seed(records);seedCategories(records);
    const content=await encodeFullBackup(records.map(resolveCategory),{preferences:preferences.snapshot(),categories:categories.snapshot(),projects:projects.snapshot(),phrases:phrases.snapshot()});
    download(new Blob([content],{type:'application/json'}),`rasd-full-backup-${new Date().toISOString().slice(0,10)}.json`);
    notify('Full backup ready. Save it to Files or iCloud Drive.');
  }catch(error){report(error);}
  finally{for(const id of ['backup-button','settings-backup'])$(id).disabled=false;}
}
$('backup-button').onclick=backUpEverything;$('settings-backup').onclick=backUpEverything;
const pickBackup=()=>{$('restore-input').value='';$('restore-input').click();};
$('restore-button').onclick=pickBackup;$('settings-restore').onclick=pickBackup;
$('restore-input').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  for(const id of ['restore-button','settings-restore'])$(id).disabled=true;
  let replacing=false;
  try {
    requirePersistence();if(file.size>MAX_BACKUP_BYTES)throw new Error('This backup exceeds 64 MB.');
    const bundle=await decodeFullBackup(await file.text()),records=bundle.records;
    // Decode every attachment before touching the device's existing library.
    for(const record of records) {
      for(const photo of photosOf(record)){
        if(isVideo(photo))Object.assign(photo,await inspectVideo(photo.original));
        for(const blob of isVideo(photo)?[photo.thumbnail]:[photo.original,photo.thumbnail]){
          const image=await loadImage(blob),pixels=(image.width || image.naturalWidth)*(image.height || image.naturalHeight);image.close?.();
          if(!pixels || pixels>80000000)throw new Error('A backup photo exceeds the 80 MP limit.');
        }
      }
    }
    if(bundle.kind==='full'){
      const state=bundle.state;
      if(!await confirmAction('Restore everything?',`Replace this device’s saved data with ${records.length} notes, ${state.projects.names.length} projects, ${state.categories.entries.length} categories and all settings? Local drafts and unsaved edits will also be discarded. Keep a current backup first.`,'Replace & restore'))return;
      replacing=true;camera.stop();showDataStatus('Restoring backup','Keep RASD open while your photos and settings are restored.');
      await restoreFullBackup(bundle);dirty=false;location.reload();return;
    }
    const added=await importNotes(records);await refreshArchive();projects.seed(notes);refreshProjects();notify(`Added ${added} notes. Existing notes were kept.`);
  }catch(error){
    if(error.pendingRestore)showDataStatus('Restore needs attention',error.message,true);
    else{if(replacing)closeDataStatus();report(error);}
  }finally{for(const id of ['restore-button','settings-restore'])$(id).disabled=false;event.target.value='';}
};
$('help-button').onclick=()=>{reports.invalidateSetup();$('help-dialog').showModal();camera.stop();};
$('close-help').onclick=()=>$('help-dialog').close();$('help-dialog').onclose=resumeCamera;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){videoCapture?.stop();camera.stop();if(!busy)flushDraft().catch(()=>{});}
  else resumeCamera();
});
window.addEventListener('pagehide',()=>{videoCapture?.stop();camera.stop();$('note-video').pause();if(!busy)flushDraft().catch(()=>{});});
window.addEventListener('pageshow',event=>{if(event.persisted)resumeCamera();});
window.addEventListener('beforeunload',event=>{if(dirty && revision!==lastDraftRevision){event.preventDefault();event.returnValue='';}});
function connection() {$('connection').textContent=navigator.onLine?(offlineReady?'Offline ready':'On device'):'Offline';}
window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
$('today').textContent=calendarDate(new Date());

async function setupOffline() {
  if(!('serviceWorker' in navigator)) {$('offline-status').textContent='Offline mode is unavailable in this browser.';return;}
  try {
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    const update=()=>{if(registration.waiting && navigator.serviceWorker.controller)$('update-banner').hidden=false;};
    update();registration.addEventListener('updatefound',()=>{registration.installing?.addEventListener('statechange',update);});
    $('update-button').onclick=async()=>{
      if(dirty || busy || videoState!=='idle' || reports.controller) {notify('Finish your note, recording or report before updating.');return;}
      const worker=registration.waiting;if(!worker)return;
      if(!await confirmAction('Update RASD?','RASD will reopen. Saved notes will stay on this device.','Update'))return;
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
      worker.postMessage({type:'SKIP_WAITING'});
    };
    await navigator.serviceWorker.ready;
    offlineReady=true;connection();
    $('offline-status').textContent='Ready offline. Open RASD from your Home Screen after installation.';
  }catch {$('offline-status').textContent='Offline setup did not finish. Reopen RASD online.';}
}
syncTheme();refreshProjects();refreshCategories();syncNextCapture();
if(storageStartupError)notify('Storage unavailable. You can capture and export photos; reload RASD to save data.',true);
else {listNotes().then(records=>{projects.seed(records);refreshProjects();seedCategories(records);}).catch(report);refreshDrafts().catch(report);}
setupOffline();resumeCamera();
