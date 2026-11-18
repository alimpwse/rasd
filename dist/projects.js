export const PROJECTS_KEY='rasd-projects-v1';
const KEY=PROJECTS_KEY;
export class Projects {
  constructor(storage) {
    this.names=[];this.active='';
    try {
      this.storage=storage || window.localStorage;
      const value=JSON.parse(this.storage.getItem(KEY));
      if(Array.isArray(value?.names))this.names=[...new Set(value.names.filter(n=>typeof n==='string' && n.length>0 && n.length<=100))];
      if(this.names.includes(value?.active))this.active=value.active;
    } catch { /* A blocked or damaged preference store must never block photo capture. */ }
  }
  seed(notes) {this.names=[...new Set([...this.names,...notes.map(n=>n.project).filter(Boolean)])];}
  snapshot() {return {names:[...this.names],active:this.active};}
  select(name) {
    name=name.trim();
    if(name.length>100)throw new Error('Project names can be up to 100 characters.');
    if(name && !this.names.includes(name))this.names.push(name);
    this.active=name;
    try {this.storage.setItem(KEY,JSON.stringify({names:this.names,active:this.active}));}
    catch {throw new Error('Project selected for this session. This browser could not remember it for next time.');}
  }
}
