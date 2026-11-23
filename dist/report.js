import {PhotoEditor} from './editor.js';
import {photosOf,validateRecord,shareableMapsURL,formatDate,isVideo} from './model.js';
import {categoryLabel} from './categories.js';
import {PHOTO_FONT,ensurePhotoFonts} from './fonts.js';
import {textDirection} from './stamp.js';
import {ReportPDF,checkCancelled} from './pdf.js';
export const MAX_REPORT_NOTES=20;
export const MAX_REPORT_PHOTOS=50;
const PAGE={width:595.276,height:841.89},MARGIN=38,WIDTH=PAGE.width-MARGIN*2,BOTTOM=PAGE.height-54,TEXT_SCALE=3;
const INK='#18262d',MUTED='#56666f',RULE='#d8dfe2',LINE=18;

export function reportSummary(records){
  if(!Array.isArray(records)||!records.length)throw new Error('Select at least one saved note.');
  if(records.length>MAX_REPORT_NOTES)throw new Error(`Select no more than ${MAX_REPORT_NOTES} notes per report.`);
  let photoCount=0,videoCount=0;
  for(const record of records){
    if(!record||typeof record!=='object')throw new Error('A selected note is invalid.');
    const photos=photosOf(record);if(!Array.isArray(photos)||!photos.length)throw new Error('Every selected note needs a photo.');
    photoCount+=photos.length;videoCount+=photos.filter(isVideo).length;
  }
  if(photoCount>MAX_REPORT_PHOTOS)throw new Error(`Select no more than ${MAX_REPORT_PHOTOS} photos per report.`);
  return {noteCount:records.length,photoCount,...(videoCount?{videoCount}:{})};
}

function font(ctx,size=11.5,weight=400){ctx.font=`${weight} ${size}px ${PHOTO_FONT}`;}
function lines(ctx,value,width=WIDTH){
  const result=[];
  for(const paragraph of String(value).split(/\r?\n/u)){
    const direction=textDirection(paragraph);ctx.direction=direction;let line='';
    for(const word of paragraph.split(/\s+/u)){
      const next=line?`${line} ${word}`:word;
      if(ctx.measureText(next).width<=width){line=next;continue;}
      if(line){result.push({text:line,direction});line='';}
      const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word)].map(s=>s.segment):Array.from(word);
      for(const segment of segments){
        if(line&&ctx.measureText(line+segment).width>width){result.push({text:line,direction});line='';}
        line+=segment;
      }
    }
    result.push({text:line,direction});
  }
  return result;
}
function text(ctx,line,x,y,size=11.5,weight=400,color=INK){
  font(ctx,size,weight);ctx.fillStyle=color;ctx.direction=line.direction||textDirection(line.text);ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(line.text,x,y);
}
function wrapped(ctx,value,y,{size=11.5,weight=400,color=INK,lineHeight=LINE,width=WIDTH}={}){
  font(ctx,size,weight);for(const line of lines(ctx,String(value).replace(/\s+/gu,' ').trim(),width)){text(ctx,line,MARGIN,y,size,weight,color);y+=lineHeight;}return y;
}
function rule(ctx,y){ctx.strokeStyle=RULE;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(MARGIN,y);ctx.lineTo(PAGE.width-MARGIN,y);ctx.stroke();}
function heading(ctx,record,options,noteIndex,photoIndex,photoCount,continued=false){
  let y=MARGIN;
  y=wrapped(ctx,'RASD  /  SITE REPORT',y,{size:9,weight:600,color:MUTED,lineHeight:18});
  y=wrapped(ctx,options.title,y+3,{size:21,weight:600,lineHeight:29});
  y+=9;rule(ctx,y);y+=15;
  const video=isVideo(record.photos[photoIndex]);
  y=wrapped(ctx,`NOTE ${String(noteIndex+1).padStart(2,'0')}  /  ${continued?'DESCRIPTION CONTINUED':`${video?'VIDEO PREVIEW':'PHOTO'} ${photoIndex+1} OF ${photoCount}`}`,y,{size:10,weight:600,lineHeight:19});
  if(video && !continued)y=wrapped(ctx,`${Math.ceil(record.photos[photoIndex].duration)}s video · Still preview; share the video file separately.`,y,{size:9,color:MUTED,lineHeight:15});
  if(record.project)y=wrapped(ctx,record.project,y,{size:14,weight:600,lineHeight:21});
  y=wrapped(ctx,`Category: ${categoryLabel(record.category,record.categoryName)}`,y+3,{size:10,lineHeight:16,color:MUTED});
  if(options.includeDate)y=wrapped(ctx,`Date & time: ${formatDate(record.createdAt)}`,y,{size:10,lineHeight:16,color:MUTED});
  const links=[];
  if(options.includeLocation){
    const address=record.address;
    for(const [label,value] of [['Area',address.area],['Block',address.block],['Street',address.street]])if(value)y=wrapped(ctx,`${label}: ${value}`,y,{size:10,lineHeight:16,color:MUTED});
    const url=shareableMapsURL(record.location);
    if(url){text(ctx,{text:'Open location in Google Maps',direction:'ltr'},MARGIN,y,10,500,'#245d75');links.push({url,rect:{x:MARGIN,y,width:180,height:16}});y+=19;}
  }
  return {y:y+15,links};
}
function footer(ctx,pageNumber,summary){
  rule(ctx,PAGE.height-39);
  text(ctx,{text:`${summary.noteCount} notes  /  ${summary.photoCount} ${summary.videoCount?'attachments':'photos'}`,direction:'ltr'},MARGIN,PAGE.height-30,8,400,MUTED);
  font(ctx,8);const label=`Page ${pageNumber}`;text(ctx,{text:label,direction:'ltr'},PAGE.width-MARGIN-ctx.measureText(label).width,PAGE.height-30,8,400,MUTED);
}
function pageCanvas(){
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(PAGE.width*TEXT_SCALE);canvas.height=Math.ceil(PAGE.height*TEXT_SCALE);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('This device cannot prepare a report.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(canvas.width/PAGE.width,canvas.height/PAGE.height);return {canvas,ctx};
}
async function preview(textCanvas,photo,rect,signal){
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=Math.round(600*PAGE.height/PAGE.width);
  try{
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This device cannot prepare report previews.');
    ctx.drawImage(textCanvas,0,0,canvas.width,canvas.height);
    if(photo){const sx=canvas.width/PAGE.width,sy=canvas.height/PAGE.height;ctx.drawImage(photo,rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));checkCancelled(signal);
    if(!blob)throw new Error('This device could not prepare a report preview.');return blob;
  }finally{canvas.width=canvas.height=1;}
}
const breathe=()=>new Promise(resolve=>setTimeout(resolve,0));

export async function buildReport(records,{title='Site observations',order='oldest',includeLocation=true,includeDate=true,signal,onProgress}={}){
  const summary=reportSummary(records);checkCancelled(signal);
  if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('Enter a report title between 1 and 200 characters.');
  if(!['oldest','newest'].includes(order))throw new Error('Choose oldest or newest note order.');
  const notes=records.map(validateRecord).map((record,index)=>({record,index})).sort((a,b)=>(Date.parse(a.record.createdAt)-Date.parse(b.record.createdAt))*(order==='newest'?-1:1)||a.index-b.index).map(item=>item.record);
  const options={title:title.trim(),includeLocation,includeDate},pdf=new ReportPDF(),previews=[];
  await ensurePhotoFonts();checkCancelled(signal);onProgress?.({completed:0,total:summary.photoCount});
  let completed=0,pageCount=0;
  const savePage=async(canvas,ctx,links,photo,photoRect)=>{
    footer(ctx,++pageCount,summary);checkCancelled(signal);
    const small=await preview(canvas,photo,photoRect,signal);checkCancelled(signal);
    const textImage=await pdf.image(canvas,signal);checkCancelled(signal);
    const photoImage=photo?await pdf.image(photo,signal):null;checkCancelled(signal);
    pdf.page({...PAGE,textImage,photoImage,photoRect,links});previews.push(small);
    await breathe();checkCancelled(signal);
  };
  for(let noteIndex=0;noteIndex<notes.length;noteIndex++){
    const record=notes[noteIndex];let descriptionLines;
    for(let photoIndex=0;photoIndex<record.photos.length;photoIndex++){
      checkCancelled(signal);const photo=record.photos[photoIndex],editor=new PhotoEditor(document.createElement('canvas'),()=>{},()=>{}),full=document.createElement('canvas');
      let sheet;
      try{
        await editor.load(isVideo(photo)?photo.thumbnail:photo.original,isVideo(photo)?[]:photo.annotations);checkCancelled(signal);
        editor.setRecord({...record,crop:photo.crop,stamp:{...record.stamp,mode:'off'}});
        editor.composition(full,Infinity,false,false);editor.clear();
        const fullContext=full.getContext('2d');fullContext.globalCompositeOperation='destination-over';fullContext.fillStyle='#fff';fullContext.fillRect(0,0,full.width,full.height);fullContext.globalCompositeOperation='source-over';
        sheet=pageCanvas();const {canvas,ctx}=sheet,{y:top,links}=heading(ctx,record,options,noteIndex,photoIndex,record.photos.length);
        font(ctx);if(photoIndex===0)descriptionLines=lines(ctx,record.description);
        const maxHeight=Math.min(390,BOTTOM-top-(photoIndex===0?94:0));
        if(maxHeight<80)throw new Error('The report title and metadata are too long to fit a photo. Shorten the report title.');
        const scale=Math.min(WIDTH/full.width,maxHeight/full.height),rect={x:MARGIN+(WIDTH-full.width*scale)/2,y:top,width:full.width*scale,height:full.height*scale};
        let y=top+rect.height+16;
        if(photoIndex===0&&record.description){
          y=wrapped(ctx,'OBSERVATION',y,{size:9,weight:600,lineHeight:17,color:MUTED});
          const take=Math.max(0,Math.floor((BOTTOM-y)/LINE));
          for(const line of descriptionLines.splice(0,take)){text(ctx,line,MARGIN,y);y+=LINE;}
        }else if(photoIndex>0){wrapped(ctx,`Supporting photo for note ${String(noteIndex+1).padStart(2,'0')}`,y,{size:10,color:MUTED});}
        await savePage(canvas,ctx,links,full,rect);
      }finally{editor.clear();full.width=full.height=1;if(sheet)sheet.canvas.width=sheet.canvas.height=1;}
      completed++;onProgress?.({completed,total:summary.photoCount});checkCancelled(signal);
      if(photoIndex===0&&record.description){
        while(descriptionLines.length){
          const {canvas,ctx}=pageCanvas();
          try{
            let {y,links}=heading(ctx,record,options,noteIndex,photoIndex,record.photos.length,true);
            y=wrapped(ctx,'OBSERVATION',y,{size:9,weight:600,lineHeight:20,color:MUTED});
            const take=Math.floor((BOTTOM-y)/LINE);if(take<1)throw new Error('The report metadata is too long to fit. Shorten the report title.');
            for(const line of descriptionLines.splice(0,take)){text(ctx,line,MARGIN,y);y+=LINE;}
            await savePage(canvas,ctx,links);
          }finally{canvas.width=canvas.height=1;}
        }
      }
    }
  }
  checkCancelled(signal);return {blob:pdf.finish(),pageCount,previews,...summary};
}
