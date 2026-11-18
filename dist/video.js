import {MAX_VIDEO_BYTES,MAX_VIDEO_SECONDS} from './model.js';

const VIDEO_TYPES=['video/mp4','video/quicktime','video/webm'];
const unreadable=()=>new Error('This video cannot be read. Choose a supported MP4, MOV or WebM clip.');

function waitFor(video,events,ready,signal){
  if(signal.aborted)return Promise.reject(signal.reason);
  if(video.error)return Promise.reject(unreadable());
  if(ready())return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{for(const event of events)video.removeEventListener(event,check);video.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
    const check=()=>{if(ready()){cleanup();resolve();}},fail=()=>{cleanup();reject(unreadable());},abort=()=>{cleanup();reject(signal.reason);};
    for(const event of events)video.addEventListener(event,check);video.addEventListener('error',fail);signal.addEventListener('abort',abort,{once:true});
  });
}

async function readVideo(blob,thumbnail){
  if(!(blob instanceof Blob)||!blob.size||!VIDEO_TYPES.includes(blob.type.split(';')[0].trim().toLowerCase()))throw unreadable();
  if(blob.size>MAX_VIDEO_BYTES)throw new Error('Videos must be 50 MB or smaller.');
  const video=document.createElement('video'),url=URL.createObjectURL(blob),controller=new AbortController(),signal=controller.signal;
  video.preload='auto';video.muted=true;video.playsInline=true;
  const timeout=setTimeout(()=>controller.abort(new Error('This video took too long to read. Try another clip.')),20000);
  try {
    video.src=url;video.load();await waitFor(video,['loadedmetadata'],()=>video.readyState>=1,signal);
    const width=video.videoWidth,height=video.videoHeight;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>32767||height>32767||width*height>80000000)throw unreadable();
    if(!Number.isFinite(video.duration)){
      // MediaRecorder WebM often omits its Duration element. Seeking past the end
      // makes the browser demux the actual timeline and discover its duration.
      video.currentTime=1e10;
      await waitFor(video,['durationchange','seeked'],()=>Number.isFinite(video.duration)&&video.duration>0,signal);
    }
    const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0)throw unreadable();
    if(duration>MAX_VIDEO_SECONDS)throw new Error('Videos must be 60 seconds or shorter.');
    if(video.currentTime!==0||video.seeking){
      video.currentTime=0;
      await waitFor(video,['seeked','loadeddata','canplay'],()=>!video.seeking&&video.readyState>=2,signal);
    }else await waitFor(video,['loadeddata','canplay'],()=>video.readyState>=2,signal);
    const metadata={duration,width,height};
    if(!thumbnail)return metadata;
    const canvas=document.createElement('canvas'),scale=Math.min(1,640/Math.max(width,height));
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    try{
      const context=canvas.getContext('2d');if(!context)throw unreadable();context.drawImage(video,0,0,canvas.width,canvas.height);
      const preview=await new Promise((resolve,reject)=>{
        const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
        canvas.toBlob(value=>{signal.removeEventListener('abort',abort);if(value&&value.size&&value.size<=512*1024)resolve(value);else reject(new Error('A video preview could not be created.'));},'image/jpeg',.8);
      });
      if(signal.aborted)throw signal.reason;
      return {...metadata,thumbnail:preview};
    }finally{canvas.width=canvas.height=1;}
  }finally{
    clearTimeout(timeout);controller.abort(unreadable());video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
  }
}

export function inspectVideo(blob){return readVideo(blob,false);}
export async function prepareVideo(blob){
  const result=await readVideo(blob,true);
  return {id:crypto.randomUUID(),kind:'video',original:blob,...result,annotations:[],crop:{ratio:'original'}};
}
