import {buildReport,reportSummary,MAX_REPORT_NOTES,MAX_REPORT_PHOTOS} from './report.js';
import {photosOf,formatDate,isVideo} from './model.js';

const $=id=>document.getElementById(id);
const countText=(notes,photos,videos=0)=>`${notes} ${notes===1?'note':'notes'} · ${photos} ${videos?'attachments':photos===1?'photo':'photos'}`;

// Reports only read saved notes. Selection and prepared files are session state.
export class ReportUI {
  constructor({render,getRecords,getDrafts,notify,download}) {
    Object.assign(this,{render,getRecords,getDrafts,notify,download});
    this.ids=new Set();this.records=[];this.visible=[];this.mode=false;
    this.generation=0;this.setupGeneration=0;this.urls=[];this.file=null;this.controller=null;
    $('library-select').onclick=()=>this.setMode(!this.mode);
    $('select-visible').onclick=()=>this.toggleVisible();
    $('clear-selection').onclick=()=>{this.invalidateSetup();this.ids.clear();this.paint();};
    $('create-report').onclick=()=>this.open().catch(error=>this.notify(error.message,true));
    $('close-report').onclick=()=>this.close();
    $('report-dialog').oncancel=event=>{event.preventDefault();this.close();};
    $('report-dialog').onclose=()=>this.resetOutput();
    $('report-form').onsubmit=event=>{event.preventDefault();this.generate();};
    $('cancel-report-build').onclick=()=>{this.resetOutput();this.stage('setup');};
    $('edit-report').onclick=()=>{this.resetOutput();this.stage('setup');};
    $('save-report').onclick=()=>{if(this.file)this.download(this.file,this.file.name);};
    $('share-report').onclick=()=>this.share();
    $('report-order').onchange=()=>this.paintNotes();
    $('report-limits').textContent=`Up to ${MAX_REPORT_NOTES} notes · ${MAX_REPORT_PHOTOS} attachments per report`;
  }
  invalidateSetup() {this.setupGeneration++;this.opening=false;}
  setMode(mode) {
    this.invalidateSetup();this.mode=mode;if(!mode)this.ids.clear();this.render();
    $('library-select').focus({preventScroll:true});
  }
  sync(records,visible) {
    this.records=records;this.visible=visible;
    const available=new Set(records.map(note=>note.id));
    for(const id of this.ids)if(!available.has(id)){this.invalidateSetup();this.ids.delete(id);}
    this.paint();
  }
  chosen(ids=this.ids) {return this.records.filter(note=>ids.has(note.id));}
  accept(ids) {
    try {if(ids.size)reportSummary(this.chosen(ids));this.invalidateSetup();this.ids=ids;this.paint();}
    catch(error){this.notify(error.message,true);this.paint();}
  }
  toggle(id) {
    const ids=new Set(this.ids);if(ids.has(id))ids.delete(id);else ids.add(id);this.accept(ids);
  }
  toggleVisible() {
    const ids=new Set(this.ids),all=this.visible.length && this.visible.every(note=>ids.has(note.id));
    for(const note of this.visible)if(all)ids.delete(note.id);else ids.add(note.id);
    this.accept(ids);
  }
  decorate(card,open,actions,note) {
    card.dataset.noteId=note.id;
    const label=document.createElement('label');label.className='note-select-label';label.hidden=!this.mode;
    const input=document.createElement('input');input.type='checkbox';input.className='note-select';input.checked=this.ids.has(note.id);
    input.setAttribute('aria-label',`Select ${note.project || 'note'}: ${note.description || formatDate(note.createdAt)}`);
    input.onchange=()=>this.toggle(note.id);label.append(input);card.append(label);
    if(this.mode){actions.hidden=true;open.onclick=()=>this.toggle(note.id);open.setAttribute('aria-pressed',String(input.checked));}
    card.classList.toggle('is-selected',this.mode && input.checked);
  }
  paint() {
    $('archive-screen').classList.toggle('is-selecting',this.mode);
    $('library-select').textContent=this.mode?'Cancel':'Select';
    $('library-select').disabled=!this.mode && !this.records.length;
    $('library-select').setAttribute('aria-pressed',String(this.mode));
    $('selection-bar').hidden=!this.mode;$('select-visible').hidden=!this.mode;
    const chosen=this.chosen(),photos=chosen.reduce((total,note)=>total+photosOf(note).length,0);
    $('selection-summary').textContent=countText(chosen.length,photos,chosen.some(n=>photosOf(n).some(isVideo)));
    const visibleIds=new Set(this.visible.map(note=>note.id));
    const hidden=chosen.filter(note=>!visibleIds.has(note.id)).length;
    $('selection-hidden').textContent=hidden?`${hidden} selected outside these results`:this.ids.size?'Ready for one PDF':'Choose notes for your report';
    $('create-report').disabled=!chosen.length;$('clear-selection').disabled=!chosen.length;
    $('select-visible').disabled=!this.visible.length;
    $('select-visible').textContent=this.visible.length && this.visible.every(note=>this.ids.has(note.id))?'Deselect results':'Select all results';
    for(const card of $('notes-list').querySelectorAll('[data-note-id]')) {
      const selected=this.ids.has(card.dataset.noteId);card.classList.toggle('is-selected',this.mode && selected);
      card.querySelector('.note-select').checked=selected;
      if(this.mode)card.querySelector('.note-open').setAttribute('aria-pressed',String(selected));
    }
  }
  async snapshot() {
    const ids=[...this.ids],records=await this.getRecords(),byId=new Map(records.map(note=>[note.id,note]));
    if(ids.some(id=>!byId.has(id)))throw new Error('A selected note was removed. Close this report and refresh Notes.');
    const selected=ids.map(id=>byId.get(id));reportSummary(selected);return selected;
  }
  async open() {
    if(this.opening)return;this.opening=true;const setup=++this.setupGeneration;
    const current=()=>setup===this.setupGeneration && this.mode && !document.querySelector('dialog[open]');
    try {
      const selected=await this.snapshot();if(!current())return;
      const drafts=await this.getDrafts();if(!current())return;
      this.selected=selected;this.resetOutput();
      $('report-title').value='Site observations';$('report-order').value='oldest';
      $('report-location').checked=true;$('report-date').checked=true;
      this.stage('setup');this.paintNotes();
      $('report-draft-warning').hidden=!drafts.some(item=>this.ids.has(item.record.id));
      $('report-dialog').showModal();
    } catch(error){if(current())throw error;}
    finally {if(setup===this.setupGeneration)this.opening=false;}
  }
  paintNotes() {
    const records=[...(this.selected || [])],direction=$('report-order').value==='newest'?-1:1;
    records.sort((a,b)=>direction*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));
    const total=records.reduce((sum,note)=>sum+photosOf(note).length,0);
    $('report-video-warning').hidden=!records.some(n=>photosOf(n).some(isVideo));$('report-summary').textContent=countText(records.length,total,records.some(n=>photosOf(n).some(isVideo)));$('report-notes').replaceChildren();
    records.forEach((note,index)=>{
      const li=document.createElement('li'),number=document.createElement('span'),body=document.createElement('div'),title=document.createElement('strong'),desc=document.createElement('p'),meta=document.createElement('small');
      number.className='report-note-number';number.textContent=String(index+1).padStart(2,'0');
      title.dir=desc.dir='auto';title.textContent=note.project || 'No project';desc.textContent=note.description || 'No description';
      const photos=photosOf(note).length;meta.textContent=`${formatDate(note.createdAt)} · ${photos} ${photosOf(note).some(isVideo)?'attachments':photos===1?'photo':'photos'}`;
      body.append(title,desc,meta);li.append(number,body);$('report-notes').append(li);
    });
  }
  stage(stage) {
    for(const name of ['setup','building','ready'])$(`report-${name}`).hidden=name!==stage;
    $('report-dialog').dataset.stage=stage;
    $('report-heading').textContent=stage==='ready'?'Report preview':stage==='building'?'Preparing report':'Create report';
    $('report-error').textContent='';
    $('report-scroll').scrollTop=0;
  }
  resetOutput() {
    this.generation++;this.controller?.abort();this.controller=null;this.file=null;
    this.urls.forEach(URL.revokeObjectURL);this.urls=[];$('report-pages').replaceChildren();$('report-ready').hidden=true;
  }
  close() {this.invalidateSetup();this.resetOutput();$('report-dialog').close();}
  async generate() {
    this.resetOutput();const generation=this.generation,controller=new AbortController();this.controller=controller;
    const title=$('report-title').value.trim() || 'Site observations';
    const options={title,order:$('report-order').value,includeLocation:$('report-location').checked,includeDate:$('report-date').checked,signal:controller.signal};
    this.stage('building');$('report-progress').removeAttribute('value');$('report-progress-text').textContent='Opening saved attachments…';
    const current=()=>generation===this.generation && !controller.signal.aborted && $('report-dialog').open;
    try {
      this.selected=await this.snapshot();if(!current())return;
      this.paintNotes();
      const result=await buildReport(this.selected,{...options,onProgress:({completed,total})=>{
        if(!current())return;$('report-progress').max=total;$('report-progress').value=completed;
        $('report-progress-text').textContent=completed===total?'Finishing PDF…':`Attachment ${Math.min(completed+1,total)} of ${total}`;
      }});
      if(!current())return;
      const safeName=title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').trim().slice(0,80) || 'Site observations';
      this.file=new File([result.blob],`${safeName}.pdf`,{type:'application/pdf'});
      result.previews.forEach((preview,index)=>{
        const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
        const url=URL.createObjectURL(preview);this.urls.push(url);img.src=url;img.alt=`Report page ${index+1}`;img.loading=index?'lazy':'eager';
        caption.textContent=`Page ${index+1} of ${result.pageCount}`;figure.append(img,caption);$('report-pages').append(figure);
      });
      $('report-file-info').textContent=`${result.pageCount} ${result.pageCount===1?'page':'pages'} · ${(this.file.size/1024/1024).toFixed(1)} MB · PDF`;
      let canShare=false;try{canShare=!!navigator.share && !!navigator.canShare?.({files:[this.file]});}catch{/* Save PDF stays available. */}
      $('share-report').hidden=!canShare;
      $('report-share-help').textContent=canShare?'Choose WhatsApp or Files in the share sheet.':'Save the PDF to Files, then attach it in WhatsApp.';
      this.controller=null;this.stage('ready');$('save-report').focus({preventScroll:true});
    } catch(error) {
      if(!current())return;this.controller=null;this.stage('setup');
      $('report-error').textContent=error.message || 'Could not create this report. Try fewer notes.';
    }
  }
  async share() {
    if(!this.file)return;
    try {await navigator.share({files:[this.file]});}
    catch(error){if(error.name!=='AbortError')this.notify('Sharing did not finish. Save the PDF and attach it in WhatsApp.',true);}
  }
}
