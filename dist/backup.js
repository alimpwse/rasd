import {encodeBackup,decodeBackup,validateRecord,MAX_BACKUP_BYTES} from './model.js';
import {normalizePreferences,PREFERENCES_KEY} from './preferences.js';
import {CATEGORIES_KEY,normalizeCategory,normalizeCategoryName} from './categories.js';
import {PROJECTS_KEY} from './projects.js';
import {PHRASES_KEY,LEGACY_PHRASES,normalizePhrases} from './phrases.js';
import {replaceNotesWithJournal,replayRestoreJournal} from './storage.js';

function normalizeState(value) {
  if(!value?.preferences?.stamp || !value.preferences.export)throw new Error('Invalid backup preferences.');
  const preferences=normalizePreferences(value.preferences),catalog=value.categories,projects=value.projects;
  if(!Array.isArray(catalog?.entries) || catalog.entries.length>1001 || typeof catalog.defaultId!=='string')throw new Error('Invalid backup categories.');
  const ids=new Set();
  const entries=catalog.entries.map(entry=>{
    const id=normalizeCategory(entry?.id),name=normalizeCategoryName(entry?.name,id);
    if(!id || ids.has(id))throw new Error('Duplicate or invalid backup category.');
    ids.add(id);return {id,name};
  });
  // Adding the preset must not consume capacity from a previously valid full catalog.
  if(entries.length>1000 && !ids.has('cat_site_works'))throw new Error('Invalid backup categories.');
  // Older full backups predate Site Works; their original required categories remain valid.
  if(['safety','housekeeping'].some(id=>!ids.has(id)) || (catalog.defaultId!=='' && !ids.has(catalog.defaultId)))throw new Error('Missing backup category or default.');
  if(!Array.isArray(projects?.names) || projects.names.length>1000 || typeof projects.active!=='string')throw new Error('Invalid backup projects.');
  const names=new Set();
  for(const name of projects.names) {
    if(typeof name!=='string' || !name || name.length>100 || names.has(name))throw new Error('Duplicate or invalid backup project.');
    names.add(name);
  }
  if(projects.active!=='' && !names.has(projects.active))throw new Error('Missing active backup project.');
  const phrases=normalizePhrases(value.phrases===undefined?LEGACY_PHRASES:value.phrases);
  if(phrases.entries.some(entry=>entry.category && !ids.has(entry.category)))throw new Error('A phrase references a missing category.');
  return {preferences,categories:{entries,defaultId:catalog.defaultId},projects:{names:[...names],active:projects.active},phrases};
}

function normalizeFull(records,value) {
  const state=normalizeState(value);
  if(!Array.isArray(records) || records.length>500)throw new Error('A backup can contain at most 500 notes.');
  const ids=new Set(),categories=new Set(state.categories.entries.map(entry=>entry.id)),projects=new Set(state.projects.names);
  const clean=records.map(record=>{
    const note=validateRecord(record);
    if(ids.has(note.id))throw new Error('This backup contains duplicate IDs.');
    if(note.category && !categories.has(note.category))throw new Error('A note references a missing category.');
    if(note.project && !projects.has(note.project))throw new Error('A note references a missing project.');
    ids.add(note.id);return note;
  });
  const estimate=clean.reduce((n,r)=>n+r.photos.reduce((sum,p)=>sum+(p.original.size+p.thumbnail.size)*4/3+20000,0),new Blob([JSON.stringify(state)]).size);
  if(estimate>MAX_BACKUP_BYTES)throw new Error('This backup exceeds the 64 MB limit.');
  return {kind:'full',records:clean,state};
}

export async function encodeFullBackup(records,state) {
  const clean=normalizeFull(records,state),notes=JSON.parse(await encodeBackup(clean.records));
  const json=JSON.stringify({...notes,kind:'full',state:clean.state});
  if(new Blob([json]).size>MAX_BACKUP_BYTES)throw new Error('This backup exceeds the 64 MB limit.');
  return json;
}

export async function decodeFullBackup(json) {
  if(typeof json!=='string' || new Blob([json]).size>MAX_BACKUP_BYTES)throw new Error('This file exceeds the 64 MB import limit.');
  let data;
  try {data=JSON.parse(json);}catch{throw new Error('This is not a valid backup file.');}
  if(data?.app!=='rasd' || ![1,2,3,4].includes(data.version) || (data.version>=3 && !['notes','full'].includes(data.kind)))throw new Error('Unsupported backup format.');
  if(data.version===1)return {kind:'legacy',records:await decodeBackup(json)};
  if(data.version>=3 && data.kind==='notes')return {kind:'notes',records:await decodeBackup(json)};
  const state=normalizeState(data.state);
  const records=await decodeBackup(JSON.stringify({...data,version:data.version===2?1:data.version,kind:'notes'}));
  return normalizeFull(records,state);
}

function unfinishedRestore(cause){
  const error=new Error('Restore is unfinished. Reload RASD to retry restoring settings before taking or editing photos.',{cause});
  error.pendingRestore=true;return error;
}
export async function recoverPendingRestore() {
  try {
    return await replayRestoreJournal((value,id)=>{
      const state=normalizeState(value),storage=window.localStorage;
      for(const [key,value] of [[PREFERENCES_KEY,state.preferences],[CATEGORIES_KEY,state.categories],[PROJECTS_KEY,state.projects],[PHRASES_KEY,state.phrases],['rasd-restore-revision',id]]) {
        const json=JSON.stringify(value);
        storage.setItem(key,json);
        if(storage.getItem(key)!==json)throw new Error('The browser did not retain restored settings.');
      }
    });
  }catch(cause){
    if(cause.pendingRestore)throw unfinishedRestore(cause);
    throw cause;
  }
}

// Caller confirms replacement and pauses the UI; await recovery before constructing settings classes at startup.
export async function restoreFullBackup(bundle) {
  if(bundle?.kind!=='full')throw new Error('Only a full backup can replace this device.');
  const clean=normalizeFull(bundle.records,bundle.state);
  await replaceNotesWithJournal(clean.records,clean.state);
  try{await recoverPendingRestore();}catch(cause){throw unfinishedRestore(cause);}
}
