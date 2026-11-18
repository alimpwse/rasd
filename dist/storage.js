import {validateRecord} from './model.js';

let database,opening,revision;
async function open() {
  if(database)return database;
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
    // Older photo-only builds must not overwrite records containing videos.
    const request=indexedDB.open('rasd-field-notes',5);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('notes'))request.result.createObjectStore('notes',{keyPath:'id'});
      if(!request.result.objectStoreNames.contains('restore'))request.result.createObjectStore('restore');
      if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts',{keyPath:'id'});
    };
    request.onsuccess=()=>{
      database=request.result;
      database.onversionchange=()=>{database.close();database=undefined;};
      resolve(database);
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Close other RASD windows and try again.'));
  });
  try{return await opening;}finally{opening=undefined;}
}

async function transaction(mode,action,recovery=false) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['notes','restore','drafts'],mode),journal=tx.objectStore('restore');
    let result,failure;
    const fail=error=>{failure=error;tx.abort();};
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(failure || tx.error || new Error('Save did not complete.'));
    const current=journal.get('revision');
    current.onsuccess=()=>{
      const currentRevision=current.result || '';
      if(revision===undefined)revision=currentRevision;
      const pending=journal.get('pending');
      pending.onsuccess=()=>{
        try {
          if(mode==='readwrite' && !recovery) {
            if(pending.result)throw new Error('A full restore is pending. Reload RASD to finish before changing notes.');
            if(revision!==currentRevision)throw new Error('A backup was restored in another window. Reload RASD before changing notes.');
          }
          action(tx.objectStore('notes'),value=>{result=value;},journal,pending.result,currentRevision,fail,tx.objectStore('drafts'));
        }catch(error){fail(error);}
      };
    };
  });
}

export const listNotes=()=>transaction('readonly',(store,done)=>{
  const request=store.getAll();
  request.onsuccess=()=>done(request.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});
const draftConflict=()=>Object.assign(new Error('This note changed in another window. Discard local changes, then reopen it from Notes.'),{name:'DraftConflictError'});
function withDraft(drafts,id,expectedVersion,fail,action){
  const request=drafts.get(id);
  request.onsuccess=()=>{
    try{
      if((request.result?.version || null)!==expectedVersion)throw draftConflict();
      action(request.result);
    }catch(error){fail(error);}
  };
}
export const saveNote=(record,options)=>{
  const clean=validateRecord(record);
  return transaction('readwrite',(store,done,journal,pending,currentRevision,fail,drafts)=>{
    if(!options){store.put(clean);return;}
    withDraft(drafts,clean.id,options.draftVersion,fail,()=>{
      const write=()=>{store.put(clean);drafts.delete(clean.id);};
      if(!options.saved){write();return;}
      const existing=store.get(clean.id);
      existing.onsuccess=()=>{try{if(!existing.result)throw draftConflict();write();}catch(error){fail(error);}};
    });
  });
};
export const deleteNote=id=>transaction('readwrite',(store,done,journal,pending,currentRevision,fail,drafts)=>{store.delete(id);drafts.delete(id);});

export const listDrafts=()=>transaction('readonly',(store,done,journal,pending,currentRevision,fail,drafts)=>{
  const request=drafts.getAll();request.onsuccess=()=>done(request.result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
});
export const saveDraft=(record,saved,expectedVersion)=>{
  const clean=validateRecord(record);
  const envelope={id:clean.id,record:clean,saved:!!saved,updatedAt:new Date().toISOString(),version:crypto.randomUUID()};
  return transaction('readwrite',(store,done,journal,pending,currentRevision,fail,drafts)=>{
    withDraft(drafts,clean.id,expectedVersion,fail,()=>{
      const write=()=>{drafts.put(envelope);done(envelope);};
      if(!saved){write();return;}
      const existing=store.get(clean.id);
      existing.onsuccess=()=>{try{if(!existing.result)throw draftConflict();write();}catch(error){fail(error);}};
    });
  });
};
export const deleteDraft=(id,expectedVersion)=>transaction('readwrite',(store,done,journal,pending,currentRevision,fail,drafts)=>{
  withDraft(drafts,id,expectedVersion,fail,()=>drafts.delete(id));
});

export const importNotes=records=>{
  const clean=records.map(validateRecord);
  return transaction('readwrite',(store,done,journal,pending,currentRevision,fail)=>{
    let added=0;
    for(const record of clean) {
      const request=store.get(record.id);
      request.onsuccess=()=>{
        try {
          if(!request.result) {store.add(record);added++;}
          done(added);
        }catch(error){fail(error);}
      };
    }
    done(0);
  });
};

// Notes and the settings needed to interpret them become durable together.
export const replaceNotesWithJournal=(records,state)=>transaction('readwrite',(store,done,journal,pending,currentRevision,fail,drafts)=>{
  const id=crypto.randomUUID();
  store.clear();
  drafts.clear();
  for(const record of records)store.put(record);
  journal.put({id,state},'pending');
  journal.put(id,'revision');
});

export async function replayRestoreJournal(apply) {
  let observedPending=false;
  try{
  const result=await transaction('readwrite',(store,done,journal,pending,currentRevision)=>{
    if(!pending){done(null);return;}
    observedPending=true;
    if(pending.id!==currentRevision || !pending.state)throw new Error('The pending restore journal is invalid.');
    // localStorage is synchronous: this transaction serializes replay and journal removal across windows.
    apply(pending.state,pending.id);
    journal.delete('pending');
    done(currentRevision);
  },true);
  if(result!==null)revision=result;
  return result!==null;
  }catch(error){if(observedPending)error.pendingRestore=true;throw error;}
}
