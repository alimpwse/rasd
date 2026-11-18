import {saveDraft,deleteDraft,saveNote} from './storage.js';

// One queue orders snapshots and explicit save/discard. The durable version also
// prevents an old tab from restoring a draft deleted, saved or edited elsewhere.
export class DraftSession {
  constructor(envelope=null){this.version=envelope?.version || null;this.queue=Promise.resolve();}
  run(action){const next=this.queue.catch(()=>{}).then(action);this.queue=next;return next;}
  persist(record,saved){
    return this.run(async()=>{const result=await saveDraft(record,saved,this.version);this.version=result.version;return result;});
  }
  commit(record,saved=false){
    return this.run(async()=>{await saveNote(record,{draftVersion:this.version,saved});this.version=null;});
  }
  discard(id){
    return this.run(async()=>{if(this.version)await deleteDraft(id,this.version);this.version=null;});
  }
}
