import {categoryLabel} from './categories.js';
import {calendarDate,formatTime} from './datetime.js';
import {PHOTO_FONT} from './fonts.js';
export const DEFAULT_STAMP=Object.freeze({mode:'strip',date:true,time:true,location:true,note:true,project:true,category:true,address:Object.freeze({area:true,block:true,street:true})});
export function normalizeStamp(value) {
  if(value===undefined) return {...DEFAULT_STAMP,mode:'off'};
  if(!value || !['off','overlay','strip'].includes(value.mode) ||
     ['date','time','location','note','project'].some(key=>typeof value[key]!=='boolean')) throw new Error('Invalid photo information settings.');
  if(value.category!==undefined && typeof value.category!=='boolean')throw new Error('Invalid photo information settings.');
  if(value.address!==undefined && (!value.address || typeof value.address!=='object' || Array.isArray(value.address) || ['area','block','street'].some(key=>typeof value.address[key]!=='boolean')))throw new Error('Invalid printed address settings.');
  return {...(value.address===undefined?{}:{address:Object.fromEntries(['area','block','street'].map(key=>[key,value.address[key]]))}),...Object.fromEntries(['mode','date','time','location','note','project'].map(key=>[key,value[key]])),...(value.category===undefined?{}:{category:value.category})};
}
export function textDirection(text) {
  // Use the first strong letter; Arabic descriptions can also contain Latin IDs.
  const first=String(text).match(/[\p{L}]/u)?.[0] || '';
  return /[\u0590-\u08ff]/u.test(first)?'rtl':'ltr';
}
export function stampSections(record) {
  const s=normalizeStamp(record?.stamp);
  if(s.mode==='off') return [];
  const sections=[];
  if(s.project && record.project)sections.push({label:'PROJECT',text:record.project});
  if(s.category && record.category)sections.push({label:'CATEGORY',text:categoryLabel(record.category,record.categoryName)});
  const datetime=[s.date?calendarDate(record.createdAt):'',s.time?formatTime(record.createdAt):''].filter(Boolean).join('  ·  ');
  if(datetime)sections.push({label:'RECORDED',text:datetime});
  if(s.location) {
    const a=record.address || {};
    const parts=s.address || DEFAULT_STAMP.address;
    const address=[parts.area&&a.area,parts.block&&a.block&&`Block ${a.block}`,parts.street&&a.street&&`Street ${a.street}`].filter(Boolean).join(' · ');
    if(address)sections.push({label:'LOCATION',text:address});
  }
  if(s.note && record.description)sections.push({label:'NOTE',text:record.description});
  return sections;
}
export function wrapText(ctx,text,maxWidth) {
  const result=[];
  for(const paragraph of text.split('\n')) {
    let line='';
    for(const word of paragraph.split(/\s+/u)) {
      const candidate=line?`${line} ${word}`:word;
      if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
      if(line){result.push(line);line='';}
      // Also wrap long IDs/URLs rather than clipping them outside the photo.
      for(const character of word) {
        if(line && ctx.measureText(line+character).width>maxWidth){result.push(line);line='';}
        line+=character;
      }
    }
    result.push(line);
  }
  return result;
}
// Size from image width: a landscape export viewed on a phone must be as
// readable as a portrait export. Reading direction is independent of alignment.
export function layoutStamp(ctx,record,width,height) {
  const sections=stampSections(record),rows=[];
  if(!sections.length)return {height:0,sections,rows};
  const fontSize=Math.max(14,width*.038),pad=Math.max(12,width*.04),gap=fontSize*.55;
  const contentWidth=width-2*pad,byLabel=Object.fromEntries(sections.map(s=>[s.label,s.text]));
  let y=pad;
  const measure=(text,size,weight=500)=>{ctx.font=`${weight} ${size}px ${PHOTO_FONT}`;return ctx.measureText(text).width;};
  const row=(label,text,x,available,size,weight=500,icon='',inset=icon?size*1.65:0)=>{
    ctx.font=`${weight} ${size}px ${PHOTO_FONT}`;
    const lines=wrapText(ctx,text,available-inset),lineHeight=size*1.45;
    return {label,text,x,y,width:available,height:lines.length*lineHeight,lines,fontSize:size,weight,lineHeight,icon,inset};
  };
  const project=byLabel.PROJECT,category=byLabel.CATEGORY;
  if(project || category){
    const projectWidth=project?measure(project,fontSize*.96,600):0;
    const badgeWidth=category?Math.min(contentWidth,measure(category,fontSize*.84,600)+fontSize*1.1):0;
    const paired=project && category && !project.includes('\n') && projectWidth+gap+badgeWidth<=contentWidth;
    if(project){
      const item=row('PROJECT',project,pad,paired?projectWidth:contentWidth,fontSize*.96,600);
      rows.push(item);y+=item.height;
    }
    if(category){
      if(paired)y=pad;
      else if(project)y+=gap*.5;
      const item=row('CATEGORY',category,paired?pad+projectWidth+gap:pad,badgeWidth,fontSize*.84,600,'',fontSize*.55);
      ctx.font=`600 ${item.fontSize}px ${PHOTO_FONT}`;
      item.pill=true;item.lines=wrapText(ctx,category,badgeWidth-item.inset*2);
      item.height=item.lines.length*item.lineHeight+fontSize*.2;
      rows.push(item);y=Math.max(...rows.map(r=>r.y+r.height));
    }
    y+=gap;
  }
  if(byLabel.NOTE){
    const item=row('NOTE',byLabel.NOTE,pad,contentWidth,fontSize*1.18,600);
    rows.push(item);y+=item.height+gap;
  }
  const metaY=y,location=byLabel.LOCATION,recorded=byLabel.RECORDED,metaSize=fontSize*.9;
  const dateWidth=recorded?measure(recorded,metaSize)+metaSize*1.65:0;
  const locationWidth=location?measure(location,metaSize)+metaSize*1.65:0;
  const inline=width>height && location && recorded && locationWidth+dateWidth+gap<=contentWidth;
  if(location){
    const item=row('LOCATION',location,pad,inline?locationWidth:contentWidth,metaSize,500,'pin');
    rows.push(item);y+=item.height+gap*.5;
  }
  if(recorded){
    if(inline)y=metaY;
    const item=row('RECORDED',recorded,inline?pad+locationWidth+gap:pad,inline?dateWidth:contentWidth,metaSize,500,'clock');
    rows.push(item);y=Math.max(y+item.height,...rows.map(r=>r.y+r.height));
  }
  const total=Math.ceil(Math.max(...rows.map(r=>r.y+r.height))+pad);
  if(record.stamp.mode==='overlay' && total>height*.85)throw new Error('This information is too long for an overlay. Choose Information strip or shorten the note.');
  return {height:total,sections,rows,fontSize,pad,gap};
}
function drawIcon(ctx,kind,x,y,size){
  ctx.save();ctx.translate(x,y);ctx.scale(size/24,size/24);ctx.lineWidth=1.6;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  if(kind==='pin'){
    ctx.moveTo(12,22);ctx.bezierCurveTo(9,18,5,14,5,9);ctx.arc(12,9,7,Math.PI,0);ctx.bezierCurveTo(19,14,15,18,12,22);
    ctx.moveTo(14.5,9);ctx.arc(12,9,2.5,0,Math.PI*2);
  }else{ctx.arc(12,12,9,0,Math.PI*2);ctx.moveTo(12,6);ctx.lineTo(12,12);ctx.lineTo(16,14);}
  ctx.stroke();ctx.restore();
}
export function drawStamp(ctx,layout,width,top,overlay=false) {
  if(!layout.height)return;
  ctx.save();ctx.shadowBlur=0;
  if(overlay){
    const start=Math.max(0,top-layout.fontSize*3.5),end=top+layout.height;
    const shoulder=(top+layout.pad-start)/(end-start),fade=ctx.createLinearGradient(0,start,0,end);
    for(const [position,alpha] of [[0,0],[shoulder*.35,.08],[shoulder*.7,.28],[shoulder,.54],[1,.72]])fade.addColorStop(position,`rgba(0,0,0,${alpha})`);
    ctx.fillStyle=fade;ctx.fillRect(0,start,width,top-start);
  }else ctx.fillStyle='#f7f7f2';
  ctx.fillRect(0,top,width,layout.height);
  for(const item of layout.rows){
    const {x,y,fontSize,weight,lines,lineHeight,inset}=item;ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    const color=item.label==='NOTE' || item.label==='PROJECT'?(overlay?'#ffffff':'#182229'):(overlay?'#ffffff':'#334148');
    if(item.pill){
      ctx.fillStyle=overlay?'#edc15b':'#eee1bb';
      ctx.beginPath();ctx.roundRect(x,top+y,item.width,item.height,fontSize*.3);ctx.fill();
    }
    ctx.font=`${weight} ${fontSize}px ${PHOTO_FONT}`;ctx.fillStyle=item.pill?'#493b19':color;ctx.strokeStyle=color;
    ctx.textBaseline='top';
    if(item.icon)drawIcon(ctx,item.icon,x,top+y+fontSize*.22,fontSize);
    ctx.direction=textDirection(item.text);ctx.textAlign='left';
    if(overlay && !item.pill){ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=fontSize*.09;ctx.shadowOffsetY=fontSize*.025;}
    const textX=x+inset;
    lines.forEach((line,index)=>ctx.fillText(line,textX,top+y+index*lineHeight+(item.pill?fontSize*.1:0)));
  }
  ctx.restore();
}
