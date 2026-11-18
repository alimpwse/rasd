import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STAMP,normalizeStamp,stampSections,layoutStamp,drawStamp} from '../dist/stamp.js';
import {encodeBackup,decodeBackup} from '../dist/model.js';
const sample=()=>({id:'sample',createdAt:'2026-11-17T09:05:00Z',project:'Site A',description:'ملاحظة عربية عن الموقع',category:'safety',address:{area:'Salmiya',block:'5',street:'10'},location:null,original:new Blob(['original'],{type:'image/png'}),thumbnail:new Blob(['thumb'],{type:'image/png'}),annotations:[],stamp:{...DEFAULT_STAMP}});
const ctx=()=>({font:'',measureText(text){return {width:[...text].length*parseFloat(this.font.match(/[\d.]+(?=px)/)?.[0]||'16')*.55};}});
test('photo text remains readable at phone width for portrait and landscape',()=>{
 for(const [width,height] of [[4032,3024],[3024,4032],[1600,900]]){
  const layout=layoutStamp(ctx(),sample(),width,height);
  assert.ok(layout.rows.find(r=>r.label==='NOTE').fontSize/width*390>=17);
  for(const row of layout.rows){assert.ok(row.fontSize/width*390>=12);assert.ok(row.weight>=500);}
 }
});
test('printed address can omit area independently and survives backup without deleting saved address',async()=>{
 const record=sample();record.stamp.address={area:false,block:true,street:true};
 assert.equal(stampSections(record).find(x=>x.label==='LOCATION').text,'Block 5 · Street 10');
 const [restored]=await decodeBackup(await encodeBackup([record]));assert.deepEqual(restored.stamp.address,record.stamp.address);assert.equal(restored.address.area,'Salmiya');
 for(const address of [null,{area:'no',block:true,street:true},{area:true}])assert.throws(()=>normalizeStamp({...DEFAULT_STAMP,address}));
 const legacy={...record};delete legacy.stamp.address;assert.match(stampSections(legacy).find(x=>x.label==='LOCATION').text,/Salmiya/);
});
test('all address parts off omit the location row while preserving the rest of the stamp',()=>{
 const record=sample();record.stamp.address={area:false,block:false,street:false};
 assert.equal(stampSections(record).some(x=>x.label==='LOCATION'),false);assert.ok(stampSections(record).some(x=>x.label==='NOTE'));
});

test('Arabic and Latin text share the same left alignment without changing reading direction',()=>{
 const drawing=ctx(),calls=[];Object.assign(drawing,{save(){},restore(){},fillRect(){},beginPath(){},roundRect(){},fill(){},translate(){},scale(){},moveTo(){},lineTo(){},bezierCurveTo(){},arc(){},stroke(){},fillText(text,x,y){calls.push({text,x,y,align:this.textAlign,direction:this.direction});}});
 const layout=layoutStamp(drawing,sample(),1600,900);drawStamp(drawing,layout,1600,900);
 assert.ok(calls.every(x=>x.align==='left'));assert.equal(calls.find(x=>x.text.includes('ملاحظة')).direction,'rtl');assert.equal(calls.find(x=>x.text==='Site A').direction,'ltr');
 const project=layout.rows.find(r=>r.label==='PROJECT'),category=layout.rows.find(r=>r.label==='CATEGORY');assert.ok(category.x+category.width<800,'short header stays grouped at the left');
});
test('overlay fades in above the information with a lighter monotonic gradient',()=>{
 const drawing=ctx(),stops=[];let gradientTop;Object.assign(drawing,{save(){},restore(){},fillRect(){},beginPath(){},roundRect(){},fill(){},translate(){},scale(){},moveTo(){},lineTo(){},bezierCurveTo(){},arc(){},stroke(){},fillText(){},createLinearGradient(x,y){gradientTop=y;return {addColorStop(position,color){stops.push({position,alpha:Number(color.match(/[\d.]+(?=\)$)/)[0])});}};}});
 const record=sample();record.stamp.mode='overlay';const layout=layoutStamp(drawing,record,1600,900),top=900-layout.height;drawStamp(drawing,layout,1600,top,true);
 assert.ok(gradientTop<top);assert.ok(stops.length>=5);assert.equal(stops[0].alpha,0);assert.ok(stops.at(-1).alpha<=.72);
 for(let i=1;i<stops.length;i++){assert.ok(stops[i].position>stops[i-1].position);assert.ok(stops[i].alpha>=stops[i-1].alpha);}
});
