export const CATEGORIES=Object.freeze({safety:'Safety',housekeeping:'Site Cleanliness',cat_site_works:'Site Works'});
export const CATEGORIES_KEY='rasd-categories-v1';
const KEY=CATEGORIES_KEY;
const isCustom=value=>/^cat_[a-zA-Z0-9_-]{1,72}$/.test(value);
export const categoryLabel=(value,name='')=>value?(name || (Object.hasOwn(CATEGORIES,value)?CATEGORIES[value]:'Uncategorized')):'Uncategorized';
export function normalizeCategory(value='') {
  if(typeof value!=='string' || (value!=='' && !Object.hasOwn(CATEGORIES,value) && !isCustom(value)))throw new Error('Invalid note category.');
  return value;
}
function normalizeName(value) {
  if(typeof value!=='string')throw new Error('Enter a category name.');
  const name=value.normalize('NFC').replace(/\s+/gu,' ').trim();
  if(!name || name.length>60)throw new Error('Use a category name between 1 and 60 characters.');
  return name;
}
export function normalizeCategoryName(value,id) {
  if(value===undefined) {
    if(isCustom(id))throw new Error('A custom category needs a name.');
    return id?CATEGORIES[id]:'';
  }
  if(id==='') {
    if(value!=='')throw new Error('An uncategorized note cannot have a category name.');
    return '';
  }
  return normalizeName(value);
}
export class Categories {
  constructor(storage) {
    this.entries=[];this.defaultId='';
    try {
      this.storage=storage || window.localStorage;
      const saved=JSON.parse(this.storage.getItem(KEY));
      if(Array.isArray(saved?.entries))for(const entry of saved.entries) {
        try {
          const id=normalizeCategory(entry?.id),name=normalizeName(entry?.name);
          if(id && !this.entries.some(x=>x.id===id))this.entries.push({id,name});
        }catch{ /* Ignore only malformed catalog entries, retaining valid names. */ }
      }
      if(this.list().some(x=>x.id===saved?.defaultId))this.defaultId=saved.defaultId;
    }catch{ /* Default categories remain available when preferences cannot be read. */ }
  }
  list() {
    const items=new Map(Object.entries(CATEGORIES).map(([id,name])=>[id,{id,name}]));
    for(const entry of this.entries)items.set(entry.id,{...entry});
    if(!this.entries.some(entry=>entry.id==='cat_site_works')) {
      const names=new Set([...items.values()].filter(entry=>entry.id!=='cat_site_works').map(entry=>entry.name.toLocaleLowerCase()));
      const preset=items.get('cat_site_works');let suffix=0;
      while(names.has(preset.name.toLocaleLowerCase())) {
        suffix++;preset.name=suffix===1?'Site Works (default)':`Site Works (default ${suffix})`;
      }
    }
    return [...items.values()];
  }
  snapshot() {return {entries:this.list(),defaultId:this.defaultId};}
  label(id,fallback='') {return this.list().find(x=>x.id===id)?.name || categoryLabel(id,fallback);}
  commit(entries,defaultId=this.defaultId) {
    try {this.storage.setItem(KEY,JSON.stringify({entries,defaultId}));}
    catch {throw new Error('Could not save categories on this device. Your previous choices are unchanged.');}
    this.entries=entries;this.defaultId=defaultId;
  }
  uniqueName(value,id='') {
    const name=normalizeName(value),fold=name.toLocaleLowerCase();
    if(fold==='uncategorized' || this.list().some(x=>x.id!==id && x.name.toLocaleLowerCase()===fold))throw new Error('A category with this name already exists.');
    return name;
  }
  add(value) {
    const name=this.uniqueName(value),id=`cat_${crypto.randomUUID()}`;
    this.commit([...this.entries,{id,name}]);return id;
  }
  rename(id,value) {
    if(!this.list().some(x=>x.id===id))throw new Error('Choose an existing category.');
    const name=this.uniqueName(value,id);
    this.commit([...this.entries.filter(x=>x.id!==id),{id,name}]);
  }
  setDefault(id) {
    if(id!=='' && !this.list().some(x=>x.id===id))throw new Error('Choose an existing category.');
    this.commit(this.entries,id);
  }
  seed(records) {
    // Missing definitions can be recovered from note backups without overwriting
    // an existing local rename or changing the default for new captures.
    let changed=false;
    for(const record of records) {
      try {
        const id=normalizeCategory(record.category),name=normalizeCategoryName(record.categoryName,id);
        if(!id || this.entries.some(x=>x.id===id) || CATEGORIES[id]===name)continue;
        this.entries.push({id,name});changed=true;
      }catch{ /* Invalid legacy metadata must not prevent the library opening. */ }
    }
    if(changed)try {this.storage.setItem(KEY,JSON.stringify({entries:this.entries,defaultId:this.defaultId}));}catch{ /* Names also remain in the saved notes. */ }
  }
}
