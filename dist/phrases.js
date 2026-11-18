import {normalizeCategory} from './categories.js';

export const PHRASES_KEY='rasd-phrases-v1';
export const LEGACY_PHRASES=Object.freeze({entries:Object.freeze([
  {id:'safety-ppe',category:'safety',text:'Required PPE is not being used.'},
  {id:'safety-opening',category:'safety',text:'An opening needs a protective barrier.'},
  {id:'safety-access',category:'safety',text:'Access is obstructed.'},
  {id:'housekeeping-debris',category:'housekeeping',text:'Construction debris needs to be removed.'},
  {id:'housekeeping-cleaning',category:'housekeeping',text:'The work area needs cleaning.'},
  {id:'housekeeping-materials',category:'housekeeping',text:'Materials need to be stored neatly.'}
].map(Object.freeze))});
const ARABIC_TEXT=Object.freeze({
  'safety-ppe':'عدم الالتزام بإجراءات الأمن والسلامة.',
  'safety-opening':'الحواجز غير مغلقة بإحكام.',
  'safety-access':'الحواجز غير كافية لتأمين الموقع.',
  'housekeeping-debris':'إزالة الأنقاض.',
  'housekeeping-cleaning':'تنظيف الموقع.',
  'housekeeping-materials':'إزالة البايبات.'
});
const MILLING=Object.freeze({id:'siteworks-milling',category:'cat_site_works',text:'فرش طبقة ميلينق.'});
export const DEFAULT_PHRASES=Object.freeze({defaultsVersion:2,entries:Object.freeze([
  ...LEGACY_PHRASES.entries.map(entry=>Object.freeze({...entry,text:ARABIC_TEXT[entry.id]})),MILLING
])});

export function normalizePhrases(value) {
  if(!Array.isArray(value?.entries) || value.entries.length>1000)throw new Error('Invalid saved phrases.');
  if(value.defaultsVersion!==undefined && ![1,2].includes(value.defaultsVersion))throw new Error('Unsupported phrase defaults version.');
  const ids=new Set(),counts=new Map();
  const entries=value.entries.map(entry=>{
    if(!entry || typeof entry.id!=='string' || entry.id.length>80 || !/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id))throw new Error('Duplicate or invalid phrase ID.');
    if(typeof entry.category!=='string')throw new Error('Invalid phrase category.');
    const category=normalizeCategory(entry.category);
    if(typeof entry.text!=='string' || !entry.text.trim() || entry.text.trim().length>300)throw new Error('Use a phrase between 1 and 300 characters.');
    counts.set(category,(counts.get(category)||0)+1);
    if(counts.get(category)>20)throw new Error('Each category can have at most 20 phrases.');
    ids.add(entry.id);
    return {id:entry.id,category,text:entry.text.trim()};
  });
  return {...(value.defaultsVersion===undefined?{}:{defaultsVersion:value.defaultsVersion}),entries};
}

function upgradePresets(value) {
  if(value.defaultsVersion===2)return value;
  let replaced=false;
  const entries=value.entries.map(entry=>{
    const old=LEGACY_PHRASES.entries.find(old=>old.id===entry.id && old.category===entry.category && old.text===entry.text);
    if(!old)return entry;
    replaced=true;return {...entry,text:ARABIC_TEXT[entry.id]};
  });
  // Only untouched presets are upgraded; explicit edits, deletions and full catalogs stay intact.
  if(replaced && entries.length<1000 && entries.filter(e=>e.category===MILLING.category).length<20 &&
     !entries.some(e=>e.id===MILLING.id || (e.category===MILLING.category && e.text===MILLING.text)))entries.push({...MILLING});
  return {defaultsVersion:2,entries};
}

export class Phrases {
  constructor(storage) {
    this.value=normalizePhrases(DEFAULT_PHRASES);
    try {
      this.storage=storage || window.localStorage;
      const saved=JSON.parse(this.storage.getItem(PHRASES_KEY));
      if(saved!==null){
        this.value=upgradePresets(normalizePhrases(saved));
        if(saved.defaultsVersion!==2)this.storage.setItem(PHRASES_KEY,JSON.stringify(this.value));
      }
    }catch{ /* Usable phrases remain available when storage is blocked or damaged. */ }
  }
  snapshot() {return structuredClone(this.value);}
  list(category='') {
    normalizeCategory(category);
    return this.value.entries.filter(entry=>entry.category===category).map(entry=>({...entry}));
  }
  commit(entries) {
    const next=normalizePhrases({defaultsVersion:2,entries});
    try {this.storage.setItem(PHRASES_KEY,JSON.stringify(next));}
    catch {throw new Error('Could not save phrases on this device. Your previous phrases are unchanged.');}
    this.value=next;
  }
  add(category,text) {
    const id=`phrase_${crypto.randomUUID()}`;
    this.commit([...this.value.entries,{id,category,text}]);
    return id;
  }
  edit(id,text) {
    if(!this.value.entries.some(entry=>entry.id===id))throw new Error('Choose an existing phrase.');
    this.commit(this.value.entries.map(entry=>entry.id===id?{...entry,text}:entry));
  }
  remove(id) {
    if(!this.value.entries.some(entry=>entry.id===id))throw new Error('Choose an existing phrase.');
    this.commit(this.value.entries.filter(entry=>entry.id!==id));
  }
}
