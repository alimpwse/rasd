import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryView} from '../dist/library.js';
const note=(id,createdAt,project,description='')=>({id,createdAt,project,description,address:{area:'السالمية',block:'5',street:'10'}});
const notes=[note('a','2026-11-16T20:59:00Z','Site A','Window'),note('b','2026-11-16T21:01:00Z','Site B','شرخ'),note('c','2026-11-17T09:00:00Z','Site A','نافذة'),note('d','2026-11-15T08:00:00Z','')];
test('groups at Kuwait midnight and sorts newest without mutating saved notes',()=>{
 const view=libraryView(notes,{now:new Date('2026-11-17T10:00:00Z')});
 assert.deepEqual(view.groups.map(g=>g.notes.map(n=>n.id)),[['c','b'],['a'],['d']]);
 assert.deepEqual(view.groups.slice(0,2).map(g=>g.label),['Today','Yesterday']);
 assert.deepEqual(notes.map(n=>n.id),['a','b','c','d']);
});
test('project filtering combines with Arabic or case-insensitive search and ordering',()=>{
 assert.equal(libraryView(notes,{project:'Site A',query:'نافذة'}).count,1);
 assert.equal(libraryView(notes,{project:'Site B',query:'نافذة'}).count,0);
 assert.equal(libraryView(notes,{query:'WINDOW'}).groups[0].notes[0].id,'a');
 assert.deepEqual(libraryView(notes,{project:'Site A',sort:'oldest'}).groups.flatMap(g=>g.notes.map(n=>n.id)),['a','c']);
 assert.equal(libraryView(notes,{project:''}).groups[0].notes[0].id,'d');
});
