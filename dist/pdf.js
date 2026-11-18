const MAX_PDF_BYTES=100*1024*1024;
const encoder=new TextEncoder();
const number=value=>Number(value.toFixed(3));
const sizeError=()=>new Error('This report exceeds 100 MB. Select fewer notes or photos.');
export function checkCancelled(signal){if(signal?.aborted)throw new DOMException('Report cancelled.','AbortError');}

// The photo stream retains every cropped pixel. Strips avoid an extra full RGBA/RGB copy.
async function canvasRGB(canvas,remaining,signal){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),width=canvas.width,height=canvas.height;
  if(!ctx || !width || !height)throw new Error('This device could not render a report page.');
  let row=0;
  const input=new ReadableStream({
    async pull(controller){
      try{
        // Yield to Cancel and painting even when the uncompressed reader resolves immediately.
        if(row && row%256===0)await new Promise(resolve=>setTimeout(resolve,0));
        checkCancelled(signal);
        if(row===height){controller.close();return;}
        const rows=Math.min(32,height-row),rgba=ctx.getImageData(0,row,width,rows).data,rgb=new Uint8Array(width*rows*3);
        for(let p=0,q=0;p<rgba.length;p+=4){rgb[q++]=rgba[p];rgb[q++]=rgba[p+1];rgb[q++]=rgba[p+2];}
        row+=rows;controller.enqueue(rgb);
      }catch(error){controller.error(error);}
    }
  });
  const compressed=typeof CompressionStream==='function';
  const reader=(compressed?input.pipeThrough(new CompressionStream('deflate')):input).getReader(),parts=[];
  let length=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      checkCancelled(signal);const {value,done}=await reader.read();checkCancelled(signal);if(done)break;
      length+=value.byteLength;if(length>remaining)throw sizeError();parts.push(value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  return {blob:new Blob(parts),length,compressed};
}

export class ReportPDF {
  constructor(){this.objects=[null,null];this.bytes=0;this.pages=[];}
  add(value){
    const blob=value instanceof Blob?value:new Blob([value]);
    if(this.bytes+blob.size>MAX_PDF_BYTES-65536)throw sizeError();
    this.bytes+=blob.size;this.objects.push(blob);return this.objects.length;
  }
  async image(canvas,signal){
    checkCancelled(signal);
    const {blob,length,compressed}=await canvasRGB(canvas,MAX_PDF_BYTES-this.bytes-65536,signal);
    checkCancelled(signal);
    return this.add(new Blob([`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${compressed?'/Filter /FlateDecode ':''}/Length ${length} >>\nstream\n`,blob,'\nendstream']));
  }
  page({width,height,textImage,photoImage,photoRect,links=[]}){
    const matrix=rect=>`${number(rect.width)} 0 0 ${number(rect.height)} ${number(rect.x)} ${number(height-rect.y-rect.height)} cm`;
    let content=`q ${matrix({x:0,y:0,width,height})} /Text Do Q\n`;
    if(photoImage)content+=`q ${matrix(photoRect)} /Photo Do Q\n`;
    const stream=encoder.encode(content),contentId=this.add(new Blob([`<< /Length ${stream.byteLength} >>\nstream\n`,stream,'endstream']));
    const annotations=links.map(link=>{
      const {x,y,width:w,height:h}=link.rect;
      const uri=link.url.replace(/[\\()]/g,'\\$&');
      return this.add(`<< /Type /Annot /Subtype /Link /Rect [${[x,height-y-h,x+w,height-y].map(number).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`);
    });
    const id=this.add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Text ${textImage} 0 R ${photoImage?`/Photo ${photoImage} 0 R`:''} >> >> /Contents ${contentId} 0 R ${annotations.length?`/Annots [${annotations.map(n=>`${n} 0 R`).join(' ')}]`:''} >>`);
    this.pages.push(id);
  }
  finish(){
    this.objects[0]=new Blob(['<< /Type /Catalog /Pages 2 0 R >>']);
    this.objects[1]=new Blob([`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(id=>`${id} 0 R`).join(' ')}] >>`]);
    const parts=[encoder.encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')],offsets=[0];let length=parts[0].length;
    for(let i=0;i<this.objects.length;i++){
      offsets.push(length);const head=encoder.encode(`${i+1} 0 obj\n`),tail=encoder.encode('\nendobj\n');
      parts.push(head,this.objects[i],tail);length+=head.length+this.objects[i].size+tail.length;
    }
    const xref=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
    if(length+encoder.encode(xref).length>MAX_PDF_BYTES)throw sizeError();
    parts.push(xref);return new Blob(parts,{type:'application/pdf'});
  }
}
