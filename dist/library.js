import {categoryLabel} from './categories.js';
import {formatTime,calendarDate} from './datetime.js';
const dayKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuwait',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function libraryView(notes,{query='',project=null,category=null,sort='newest',now=new Date()}={}) {
  query=query.trim().toLocaleLowerCase();
  const visible=notes.filter(note=>(project===null || note.project===project) && (category===null || (note.category || '')===category) &&
    [note.project,note.description,note.address.area,note.address.block,note.address.street,categoryLabel(note.category,note.categoryName)].join(' ').toLocaleLowerCase().includes(query));
  visible.sort((a,b)=>(Date.parse(b.createdAt)-Date.parse(a.createdAt) || a.id.localeCompare(b.id))*(sort==='oldest'?-1:1));
  const today=dayKey(now),yesterday=dayKey(new Date(Number(now)-86400000)),groups=[];
  for(const note of visible) {
    const key=dayKey(note.createdAt);
    let group=groups.at(-1);
    if(group?.key!==key) {
      group={key,label:key===today?'Today':key===yesterday?'Yesterday':calendarDate(note.createdAt),notes:[]};
      groups.push(group);
    }
    group.notes.push(note);
  }
  return {groups,count:visible.length};
}
export const noteTime=formatTime;
