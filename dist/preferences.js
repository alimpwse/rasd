import {DEFAULT_STAMP,normalizeStamp} from './stamp.js';
export const PREFERENCES_KEY='rasd-settings-v1';
const KEY=PREFERENCES_KEY;
export const MESSAGE_FIELDS=Object.freeze({project:'Project',category:'Category',note:'Note',date:'Date',time:'Time',area:'Area',block:'Block',street:'Street',map:'Google Maps link'});
export function normalizeExport(value={includeText:true}) {
  if(!value || typeof value.includeText!=='boolean')throw new Error('Invalid export settings.');
  if(value.fields!==undefined && (!value.fields || typeof value.fields!=='object' || Array.isArray(value.fields) || Object.keys(MESSAGE_FIELDS).some(key=>typeof value.fields[key]!=='boolean')))throw new Error('Invalid message fields.');
  return {includeText:value.includeText,fields:Object.fromEntries(Object.keys(MESSAGE_FIELDS).map(key=>[key,value.fields===undefined?true:value.fields[key]]))};
}
export function normalizePreferences(value) {
  if(typeof value?.autoAddress!=='boolean')throw new Error('Invalid location settings.');
  if(value.theme!==undefined && !['dark','light'].includes(value.theme))throw new Error('Invalid theme setting.');
  return {stamp:normalizeStamp(value.stamp),export:normalizeExport(value.export),autoAddress:value.autoAddress,theme:value.theme ?? 'dark'};
}
export class Preferences {
  constructor(storage) {
    this.value={stamp:{...DEFAULT_STAMP,project:false,category:false,note:false,address:{area:false,block:true,street:true}},
      export:normalizeExport({includeText:true,fields:{project:false,category:false,note:true,date:false,time:false,area:false,block:true,street:true,map:true}}),autoAddress:true,theme:'dark'};
    try {
      this.storage=storage || window.localStorage;
      const saved=JSON.parse(this.storage.getItem(KEY));
      if(saved)this.value=this.normalize(saved);
    } catch { /* Capture stays available when local preferences are blocked or damaged. */ }
  }
  normalize(value) {
    return normalizePreferences(value);
  }
  snapshot() {return structuredClone(this.value);}
  save(value) {
    this.value=this.normalize(value);
    try {this.storage.setItem(KEY,JSON.stringify(this.value));}
    catch {throw new Error('Settings apply for this session. This browser could not remember them for next time.');}
  }
}
