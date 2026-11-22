import {layoutStamp,drawStamp,textDirection} from './stamp.js';
import {cropRect} from './framing.js';
import {PHOTO_FONT,ensurePhotoFonts} from './fonts.js';
export async function loadImage(blob) {
  if(typeof createImageBitmap==='function') {
    try {return await createImageBitmap(blob,{imageOrientation:'from-image'});} catch { /* Fall through for formats only the image decoder supports. */ }
  }
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image(); image.src=url;
    await image.decode();
    return image;
  } finally {URL.revokeObjectURL(url);}
}

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const JPEG_TARGET_BYTES=8*1024*1024;
function releaseImage(image) {
  if(image instanceof HTMLCanvasElement)image.width=image.height=1;
  else image?.close?.();
}
function textLayout(ctx,s,width,height) {
  const unit=Math.min(width,height),scale=s.scale??1,x=s.x*width,y=s.y*height;
  const size=Math.max(16,unit*.05)*scale,direction=textDirection(s.text);
  ctx.font=`600 ${size}px ${PHOTO_FONT}`;ctx.direction=direction;ctx.textAlign=direction==='rtl'?'right':'left';ctx.textBaseline='top';
  const available=Math.max(unit*.05,direction==='rtl'?x:width-x);
  const lines=s.text.split('\n').map((text,i)=>({text,y:Math.min(height-unit*.06*scale,y+i*unit*.065*scale),width:Math.min(available,ctx.measureText(text).width)}));
  const textWidth=Math.max(...lines.map(line=>line.width));
  return {lines,x,scale,left:direction==='rtl'?x-textWidth:x,right:direction==='rtl'?x:x+textWidth,top:lines[0].y,bottom:lines.at(-1).y+size,available};
}

function segmentDistance(x,y,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?clamp(((x-a.x)*dx+(y-a.y)*dy)/length,0,1):0;
  return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
}

function draw(ctx,image,annotations,width,height) {
  ctx.clearRect(0,0,width,height);
  ctx.drawImage(image,0,0,width,height);
  const unit=Math.min(width,height);
  ctx.lineWidth=Math.max(2,unit*0.007);
  ctx.lineCap='round'; ctx.lineJoin='round';
  for(const s of annotations) {
    const x=s.x*width,y=s.y*height,x2=s.x2*width,y2=s.y2*height;
    ctx.strokeStyle=s.color; ctx.fillStyle=s.color;
    ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=unit*0.004;
    ctx.beginPath();
    if(s.type==='arrow') {
      const angle=Math.atan2(y2-y,x2-x),length=unit*0.035;
      ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x2,y2);
      ctx.lineTo(x2-length*Math.cos(angle-Math.PI/6),y2-length*Math.sin(angle-Math.PI/6));
      ctx.lineTo(x2-length*Math.cos(angle+Math.PI/6),y2-length*Math.sin(angle+Math.PI/6));
      ctx.closePath();ctx.fill();
    } else if(s.type==='ellipse') {
      ctx.ellipse((x+x2)/2,(y+y2)/2,Math.max(1,Math.abs(x2-x)/2),Math.max(1,Math.abs(y2-y)/2),0,0,Math.PI*2);ctx.stroke();
    } else if(s.type==='text') {
      const text=textLayout(ctx,s,width,height);
      text.lines.forEach(line=>{
        ctx.strokeStyle='rgba(0,0,0,.8)';ctx.lineWidth=unit*0.006*text.scale;
        ctx.strokeText(line.text,x,line.y,text.available);ctx.fillText(line.text,x,line.y,text.available);
      });
      ctx.lineWidth=Math.max(2,unit*0.007);
    }
  }
  ctx.shadowBlur=0;
}

export class PhotoEditor {
  constructor(canvas,onChange,getText,onSelectionChange,onTextEdit) {
    this.canvas=canvas;this.onChange=onChange;this.getText=getText;this.onSelectionChange=onSelectionChange;this.onTextEdit=onTextEdit;
    this.annotations=[];this.tool='select';this.color='#ff5b55';this.pending=null;this.previewStamp=true;this.editable=true;
    this.selectedIndex=-1;this.history=[];this.drag=null;this.pointerId=null;
    canvas.addEventListener('pointerdown',e=>this.down(e));
    canvas.addEventListener('pointermove',e=>this.move(e));
    canvas.addEventListener('pointerup',e=>this.up(e));
    canvas.addEventListener('pointercancel',event=>{if(event.pointerId===this.pointerId)this.cancelGesture();});
    canvas.addEventListener('lostpointercapture',event=>{if(event.pointerId===this.pointerId)this.cancelGesture();});
    canvas.addEventListener('dblclick',event=>{
      if(!this.editable || this.tool!=='select' || this.hitTest(event)!==this.selectedIndex || this.getSelected()?.type!=='text')return;
      event.preventDefault();
      this.editText(event);
    });
  }
  async load(blob,annotations=[],{sourceMaxSide=Infinity,renderPreview=true}={}) {
    await ensurePhotoFonts();
    let image=await loadImage(blob);
    const width=image.width || image.naturalWidth,height=image.height || image.naturalHeight;
    if(!width || !height || width*height>80000000) {image.close?.();throw new Error('Choose a photo smaller than 80 megapixels.');}
    const sourceScale=Math.min(1,sourceMaxSide/Math.max(width,height));
    if(sourceScale<1){
      const preview=document.createElement('canvas');
      preview.width=Math.max(1,Math.round(width*sourceScale));
      preview.height=Math.max(1,Math.round(height*sourceScale));
      try{
        const ctx=preview.getContext('2d');
        if(!ctx)throw new Error('This device could not preview the photo.');
        ctx.drawImage(image,0,0,preview.width,preview.height);
      }finally{releaseImage(image);}
      image=preview;
    }
    this.cancelGesture();releaseImage(this.image);this.image=image;this.width=width;this.height=height;
    this.annotations=structuredClone(annotations);this.history=[];this.selectedIndex=-1;this.tool='select';this.lastTextEdit=null;
    this.record=null;
    if(renderPreview)this.render();
  }
  point(event) {
    const box=this.canvas.getBoundingClientRect();
    const photoHeight=box.height*this.previewPhotoHeight/this.canvas.height;
    const crop=this.frame(),x=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(event.clientY-box.top)/photoHeight));
    return {x:(crop.x+x*crop.width)/this.width,y:(crop.y+y*crop.height)/this.height};
  }
  down(event) {
    if(!this.image || !this.editable || event.button!==0 || this.pointerId!==null) return;
    const box=this.canvas.getBoundingClientRect();
    if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY-box.top>box.height*this.previewPhotoHeight/this.canvas.height)return;
    event.preventDefault();
    const p=this.point(event);
    if(this.tool==='select') {
      const handle=this.hitHandle(event),previous=this.selectedIndex;
      this.selectedIndex=handle?previous:this.hitTest(event);this.render();
      if(this.selectedIndex<0)return;
      this.pointerId=event.pointerId;this.canvas.setPointerCapture(event.pointerId);
      this.drag={before:this.snapshot(),shape:this.getSelected(),x:event.clientX,y:event.clientY,bounds:this.bounds(this.annotations[this.selectedIndex]),handle,wasSelected:previous===this.selectedIndex,moved:false};
      return;
    }
    if(this.annotations.length>=200 || !['text','arrow','ellipse'].includes(this.tool))return;
    this.selectedIndex=-1;this.notifySelection();
    if(this.tool==='text') {
      const text=String(this.getText?.()??'').trim();
      if(!text)this.onTextEdit?.(null,p);else this.addTextAt(text,p);
      return;
    }
    this.pointerId=event.pointerId;this.canvas.setPointerCapture(event.pointerId);
    this.pending={type:this.tool,...p,x2:p.x,y2:p.y,color:this.color};
  }
  move(event) {
    if(event.pointerId!==this.pointerId || !this.editable)return;
    if(this.drag) {
      const drag=this.drag,box=this.canvas.getBoundingClientRect(),crop=this.frame();
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<3)return;
      drag.moved=true;
      const photoHeight=box.height*this.previewPhotoHeight/this.canvas.height,b=drag.bounds;
      const tx=dx*crop.width/box.width/this.width,ty=dy*crop.height/photoHeight/this.height,shape={...drag.shape};
      if(drag.handle?.scale) {
        const handle=this.screenPoint(drag.handle.x,drag.handle.y),anchor=this.screenPoint(drag.shape.x,b.top);
        const vx=handle.x-anchor.x,vy=handle.y-anchor.y;
        shape.scale=clamp((drag.shape.scale??1)*(1+(dx*vx+dy*vy)/Math.max(1,vx*vx+vy*vy)),.4,3);
      } else if(drag.handle) {
        const {xKey,yKey}=drag.handle;
        shape[xKey]=clamp(drag.shape[xKey]+tx,0,1);shape[yKey]=clamp(drag.shape[yKey]+ty,0,1);
      } else {
        const moveX=clamp(tx,-b.left,1-b.right),moveY=clamp(ty,-b.top,1-b.bottom);
        shape.x=clamp(drag.shape.x+moveX,0,1);shape.y=clamp(drag.shape.y+moveY,0,1);
        if(shape.type!=='text') {shape.x2=clamp(drag.shape.x2+moveX,0,1);shape.y2=clamp(drag.shape.y2+moveY,0,1);}
      }
      this.annotations[this.selectedIndex]=shape;this.render();return;
    }
    if(!this.pending) return;
    const p=this.point(event);this.pending.x2=p.x;this.pending.y2=p.y;this.render();
  }
  up(event) {
    if(event.pointerId!==this.pointerId)return;
    this.move(event);
    const drag=this.drag,pending=this.pending;this.drag=null;this.pending=null;this.releasePointer();
    if(drag) {
      if(!this.commit(drag.before))this.render();
      if(!drag.moved && drag.wasSelected && drag.shape.type==='text')this.editText(event);
      return;
    }
    if(pending && Math.hypot(pending.x2-pending.x,pending.y2-pending.y)>0.01) {
      const before=this.snapshot();this.annotations.push(pending);this.selectedIndex=this.annotations.length-1;this.tool='select';this.commit(before);
    } else this.render();
  }
  releasePointer() {const id=this.pointerId;this.pointerId=null;if(id!==null && this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);}
  cancelGesture() {
    if(this.drag)this.annotations=this.drag.before.annotations;
    this.drag=null;this.pending=null;this.releasePointer();this.render();
  }
  snapshot() {return {annotations:structuredClone(this.annotations),selectedIndex:this.selectedIndex};}
  commit(before) {
    if(JSON.stringify(before.annotations)===JSON.stringify(this.annotations))return false;
    this.history.push(before);if(this.history.length>100)this.history.shift();this.render();this.notifySelection();this.onChange();return true;
  }
  getSelected() {const shape=this.annotations[this.selectedIndex];return shape?structuredClone(shape):null;}
  committedAnnotations() {return structuredClone(this.drag?.before.annotations || this.annotations);}
  notifySelection() {
    const selected=this.getSelected(),state=JSON.stringify([this.tool,this.selectedIndex,selected,this.selectionRect()]);
    if(state===this.selectionState)return;
    this.selectionState=state;this.onSelectionChange?.(selected);
  }
  editText(event) {
    if(this.lastTextEdit?.index===this.selectedIndex && event.timeStamp-this.lastTextEdit.time<500)return;
    this.lastTextEdit={index:this.selectedIndex,time:event.timeStamp};
    this.onTextEdit?.(this.getSelected(),this.point(event));
  }
  addTextAt(text,point) {
    if(!this.image || !this.editable || this.annotations.length>=200 || typeof text!=='string' || !text.trim() || text.trim().length>160 || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x<0 || point.x>1 || point.y<0 || point.y>1)return false;
    this.cancelGesture();const before=this.snapshot();
    this.annotations.push({type:'text',x:point.x,y:point.y,text:text.trim(),color:this.color});
    this.selectedIndex=this.annotations.length-1;this.tool='select';return this.commit(before);
  }
  setTool(tool) {
    if(!['select','arrow','ellipse','text'].includes(tool))return;
    this.cancelGesture();this.tool=tool;if(tool!=='select')this.selectedIndex=-1;this.render();this.notifySelection();
  }
  changeSelected(update) {
    if(!this.editable || this.selectedIndex<0)return false;
    this.cancelGesture();const before=this.snapshot();update(this.annotations[this.selectedIndex]);return this.commit(before);
  }
  setColor(color) {
    if(typeof color!=='string' || !/^#[0-9a-f]{6}$/i.test(color))return false;
    this.color=color;return this.changeSelected(shape=>{shape.color=color;});
  }
  updateSelectedText(text) {
    if(typeof text!=='string' || !text.trim() || text.trim().length>160 || this.getSelected()?.type!=='text')return false;
    return this.changeSelected(shape=>{shape.text=text.trim();});
  }
  resizeSelected(factor) {
    if(!Number.isFinite(factor) || factor<=0 || factor===1)return false;
    return this.changeSelected(shape=>{
      if(shape.type==='text') {shape.scale=clamp((shape.scale??1)*factor,.4,3);return;}
      const cx=(shape.x+shape.x2)/2,cy=(shape.y+shape.y2)/2,dx=Math.abs(shape.x2-shape.x)/2,dy=Math.abs(shape.y2-shape.y)/2;
      const scale=Math.min(factor,dx?Math.min(cx,1-cx)/dx:Infinity,dy?Math.min(cy,1-cy)/dy:Infinity);
      shape.x=clamp(cx+(shape.x-cx)*scale,0,1);shape.x2=clamp(cx+(shape.x2-cx)*scale,0,1);
      shape.y=clamp(cy+(shape.y-cy)*scale,0,1);shape.y2=clamp(cy+(shape.y2-cy)*scale,0,1);
    });
  }
  deleteSelected() {
    if(!this.editable || this.selectedIndex<0)return false;
    this.cancelGesture();const before=this.snapshot();this.annotations.splice(this.selectedIndex,1);this.selectedIndex=-1;return this.commit(before);
  }
  undo() {
    if(!this.editable)return false;
    this.cancelGesture();const previous=this.history.pop();if(!previous)return false;
    this.annotations=previous.annotations;this.selectedIndex=this.tool==='select'?previous.selectedIndex:-1;
    this.render();this.notifySelection();this.onChange();return true;
  }
  bounds(shape) {
    if(shape.type!=='text')return {left:Math.min(shape.x,shape.x2),right:Math.max(shape.x,shape.x2),top:Math.min(shape.y,shape.y2),bottom:Math.max(shape.y,shape.y2)};
    const scale=this.canvas.width/this.frame().width,width=this.width*scale,height=this.height*scale,ctx=this.canvas.getContext('2d');
    ctx.save();const b=textLayout(ctx,shape,width,height);ctx.restore();
    return {left:b.left/width,right:b.right/width,top:b.top/height,bottom:b.bottom/height};
  }
  screenPoint(x,y) {
    const box=this.canvas.getBoundingClientRect(),crop=this.frame(),height=box.height*this.previewPhotoHeight/this.canvas.height;
    return {x:(x*this.width-crop.x)*box.width/crop.width,y:(y*this.height-crop.y)*height/crop.height};
  }
  selectionRect() {
    const shape=this.annotations[this.selectedIndex];if(!shape)return null;
    const b=this.bounds(shape),a=this.screenPoint(b.left,b.top),z=this.screenPoint(b.right,b.bottom);
    return {left:a.x,top:a.y,width:z.x-a.x,height:z.y-a.y};
  }
  selectionHandles() {
    const s=this.annotations[this.selectedIndex];if(!s || !this.editable || this.tool!=='select')return [];
    if(s.type==='arrow')return [{x:s.x,y:s.y,xKey:'x',yKey:'y'},{x:s.x2,y:s.y2,xKey:'x2',yKey:'y2'}];
    if(s.type==='ellipse')return [{x:s.x,y:s.y,xKey:'x',yKey:'y'},{x:s.x2,y:s.y,xKey:'x2',yKey:'y'},{x:s.x2,y:s.y2,xKey:'x2',yKey:'y2'},{x:s.x,y:s.y2,xKey:'x',yKey:'y2'}];
    const b=this.bounds(s);return [{x:textDirection(s.text)==='rtl'?b.left:b.right,y:b.bottom,scale:true}];
  }
  hitHandle(event) {
    const box=this.canvas.getBoundingClientRect();let closest=null,distance=22;
    for(const handle of this.selectionHandles()) {
      const p=this.screenPoint(handle.x,handle.y),d=Math.hypot(event.clientX-box.left-p.x,event.clientY-box.top-p.y);
      if(d<=distance) {closest=handle;distance=d;}
    }
    return closest;
  }
  hitTest(event) {
    const box=this.canvas.getBoundingClientRect(),crop=this.frame(),height=box.height*this.previewPhotoHeight/this.canvas.height;
    const point=(x,y)=>({x:box.left+(x*this.width-crop.x)*box.width/crop.width,y:box.top+(y*this.height-crop.y)*height/crop.height});
    const tolerance=12+Math.min(this.width*box.width/crop.width,this.height*height/crop.height)*.0035;
    for(let i=this.annotations.length-1;i>=0;i--) {
      const s=this.annotations[i],a=point(s.x,s.y),b=point(s.x2,s.y2);
      if(s.type==='arrow') {
        if(segmentDistance(event.clientX,event.clientY,a,b)<=tolerance)return i;
      } else if(s.type==='ellipse') {
        const rx=Math.abs(b.x-a.x)/2+tolerance,ry=Math.abs(b.y-a.y)/2+tolerance;
        if(((event.clientX-(a.x+b.x)/2)/rx)**2+((event.clientY-(a.y+b.y)/2)/ry)**2<=1)return i;
      } else if(s.type==='text') {
        const bounds=this.bounds(s),left=point(bounds.left,bounds.top),right=point(bounds.right,bounds.bottom);
        if(event.clientX>=left.x-tolerance && event.clientX<=right.x+tolerance && event.clientY>=left.y-tolerance && event.clientY<=right.y+tolerance)return i;
      }
    }
    return -1;
  }
  drawSelection() {
    const selected=this.annotations[this.selectedIndex];if(!selected || !this.editable || this.tool!=='select')return;
    const ctx=this.canvas.getContext('2d'),crop=this.frame(),scale=this.canvas.width/crop.width,b=this.bounds(selected);
    const unit=this.canvas.width/Math.max(1,this.canvas.getBoundingClientRect().width),pad=5*unit;
    const x=(b.left*this.width-crop.x)*scale-pad,y=(b.top*this.height-crop.y)*scale-pad,w=(b.right-b.left)*this.width*scale+2*pad,h=(b.bottom-b.top)*this.height*scale+2*pad;
    ctx.save();ctx.beginPath();ctx.rect(0,0,this.canvas.width,this.previewPhotoHeight);ctx.clip();ctx.shadowBlur=0;
    ctx.lineWidth=3*unit;ctx.strokeStyle='#16212b';ctx.strokeRect(x,y,w,h);
    ctx.lineWidth=unit;ctx.strokeStyle='#ffffff';ctx.setLineDash([5*unit,4*unit]);ctx.strokeRect(x,y,w,h);
    ctx.setLineDash([]);ctx.lineWidth=3*unit;ctx.strokeStyle='#16212b';ctx.fillStyle='#ffcf52';
    for(const handle of this.selectionHandles()) {
      ctx.beginPath();ctx.arc((handle.x*this.width-crop.x)*scale,(handle.y*this.height-crop.y)*scale,9*unit,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
    ctx.restore();
  }
  setView(view) {
    this.cancelGesture();this.previewStamp=view==='preview';this.editable=view==='markup';
    if(!this.editable)this.selectedIndex=-1;this.render();this.notifySelection();
  }
  setRecord(record,{renderPreview=true}={}) {
    this.record=record;
    if(renderPreview){const error=this.render();if(error)throw error;}
  }
  frame() {return cropRect(this.width,this.height,this.record?.crop);}
  composition(canvas,maxSide=Infinity,pending=false,includeStamp=true) {
    const crop=this.frame(),scale=Math.min(1,maxSide/Math.max(crop.width,crop.height));
    const width=Math.round(crop.width*scale),height=Math.round(crop.height*scale);
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('This device cannot prepare this image. Download the original instead.');
    const layout=this.record && includeStamp?layoutStamp(ctx,this.record,width,height):{height:0};
    canvas.width=width;canvas.height=height+(this.record?.stamp?.mode==='strip'?layout.height:0);
    if(canvas.width*canvas.height>80000000)throw new Error('The full-size image is too large for this device. Shorten the printed note or download the original.');
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
    ctx.translate(-crop.x*scale,-crop.y*scale);
    draw(ctx,this.image,[...(pending?this.annotations:this.committedAnnotations()),...(pending && this.pending?[this.pending]:[])],this.width*scale,this.height*scale);
    ctx.restore();
    drawStamp(ctx,layout,width,this.record?.stamp?.mode==='strip'?height:height-layout.height,this.record?.stamp?.mode==='overlay');
    return height;
  }
  render() {
    if(!this.image)return;
    let failure;
    try {this.previewPhotoHeight=this.composition(this.canvas,1600,true,this.previewStamp);}
    catch(error) {
      // An overlong overlay must not break annotation gestures or hide the original.
      this.previewPhotoHeight=this.composition(this.canvas,1600,true,false);
      failure=error;
    }
    this.drawSelection();this.notifySelection();return failure;
  }
  async export(maxSide=Infinity,quality=0.92,type='image/jpeg') {
    if(!this.image) throw new Error('No photo to export.');
    await ensurePhotoFonts();
    const canvas=document.createElement('canvas');
    try {
      this.composition(canvas,maxSide,false,!Number.isFinite(maxSide));
      if(type==='image/jpeg'){
        const ctx=canvas.getContext('2d');
        ctx.globalCompositeOperation='destination-over';
        ctx.fillStyle='#fff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
      }
      const encode=async level=>{
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,level));
        if(blob?.type!==type)throw new Error('Photo export failed. Download the original or try a shorter information strip.');
        return blob;
      };
      let blob=await encode(quality);
      if(type==='image/jpeg' && !Number.isFinite(maxSide)){
        // Start at high quality and keep all pixels even when the byte target is missed.
        for(const level of [0.84,0.74]){
          if(blob.size<=JPEG_TARGET_BYTES || level>=quality)continue;
          const smaller=await encode(level);
          if(smaller.size<blob.size)blob=smaller;
        }
      }
      return blob;
    } finally {canvas.width=1;canvas.height=1;}
  }
  clear() {
    releaseImage(this.image);this.image=null;this.cancelGesture();this.annotations=[];this.history=[];this.selectedIndex=-1;
    this.canvas.width=1;this.canvas.height=1;this.notifySelection();
  }
}
