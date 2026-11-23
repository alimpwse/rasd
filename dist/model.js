import {normalizeStamp} from './stamp.js';
import {normalizeCategory,normalizeCategoryName,categoryLabel} from './categories.js';
import {normalizeExport} from './preferences.js';
import {normalizeCrop} from './framing.js';
import {calendarDate,formatTime} from './datetime.js';
import {validCoordinates,locationNeedsReview} from './location.js';
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_NOTE_PHOTOS = 10;
export const MAX_NOTE_BYTES = 100 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const COLORS = ['#ff5b55', '#ffc44a', '#ffffff'];
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const mediaType = value => typeof value==='string' ? value.split(';',1)[0].trim().toLowerCase() : '';
const text = (value, max) => typeof value === 'string' && value.length <= max;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const date = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const validId = value => text(value,80) && /^[a-zA-Z0-9_-]+$/.test(value);

export const isVideo = asset => asset?.kind==='video' || mediaType(asset?.original?.type).startsWith('video/');
export function mediaExtension(blob) {
  const type=mediaType(blob?.type),extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
  return Object.hasOwn(extensions,type)?extensions[type]:'bin';
}

export function photosOf(record) {
  return record.photos === undefined ? [{id:'photo-1',original:record.original,thumbnail:record.thumbnail,annotations:record.annotations,crop:normalizeCrop(record.crop)}] : record.photos;
}

export function mapsURL(location) {
  return validCoordinates(location) ? `https://maps.google.com/?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}` : '';
}

export function shareableMapsURL(location) {
  return locationNeedsReview(location)?'':mapsURL(location);
}

export function formatDate(value) {
  return `${calendarDate(value)} · ${formatTime(value)}`;
}

export function shareText(record) {
  const {address = {}, location} = record;
  const f=normalizeExport(record.export).fields;
  const when=[f.date&&calendarDate(record.createdAt),f.time&&formatTime(record.createdAt)].filter(Boolean).join(' · ');
  return [f.project&&record.project, f.category&&record.category&&`Category: ${categoryLabel(record.category,record.categoryName)}`,f.note&&record.description,when,
    f.area&&address.area&&`Area: ${address.area}`,f.block&&address.block&&`Block: ${address.block}`,
    f.street&&address.street&&`Street: ${address.street}`,f.map&&shareableMapsURL(location)].filter(Boolean).join('\n');
}

export function validateRecord(record) {
  const invalid = () => { throw new Error('Invalid note data. Your library has not changed.'); };
  if (!record || typeof record !== 'object' || !validId(record.id) ||
      !date(record.createdAt) || !text(record.project,100) || !text(record.description,4000)) invalid();
  const a = record.address;
  if (!a || !text(a.area,100) || !text(a.block,30) || !text(a.street,100)) invalid();
  const p = record.location;
  if (p !== null && (!validCoordinates(p) || !finite(p.accuracy,0,100000) || !date(p.timestamp))) invalid();
  if (p?.pinSource!==undefined && !['manual','confirmed'].includes(p.pinSource))invalid();
  const manual = record.manualAddressFields;
  if (manual!==undefined && (!Array.isArray(manual) || manual.length>3 || manual.some(key=>!['area','block','street'].includes(key))))invalid();
  const sources=photosOf(record),ids=new Set();
  let bytes=0;
  if(!Array.isArray(sources) || !sources.length || sources.length>MAX_NOTE_PHOTOS)invalid();
  const photos=sources.map(photo=>{
    if(!photo || !validId(photo.id) || ids.has(photo.id))invalid();
    ids.add(photo.id);
    const video=isVideo(photo);
    for (const [blob,max,validType] of [[photo.original,video?MAX_VIDEO_BYTES:MAX_PHOTO_BYTES,video?VIDEO_TYPES.includes(mediaType(photo.original?.type)):MIME_TYPES.includes(photo.original?.type)], [photo.thumbnail,512*1024,MIME_TYPES.includes(photo.thumbnail?.type)]]) {
      if (!(blob instanceof Blob) || !blob.size || blob.size > max || !validType) invalid();
    }
    bytes+=photo.original.size;
    if(bytes>MAX_NOTE_BYTES)invalid();
    if (!Array.isArray(photo.annotations) || photo.annotations.length > 200) invalid();
    if(video) {
      const crop=normalizeCrop(photo.crop);
      if(photo.annotations.length || crop.ratio!=='original' || !finite(photo.duration,Number.MIN_VALUE,MAX_VIDEO_SECONDS) ||
          !Number.isInteger(photo.width) || !Number.isInteger(photo.height) || !finite(photo.width,1,32767) || !finite(photo.height,1,32767) || photo.width*photo.height>80000000)invalid();
      return {id:photo.id,kind:'video',original:photo.original,thumbnail:photo.thumbnail,duration:photo.duration,width:photo.width,height:photo.height,annotations:[],crop};
    }
    const annotations = photo.annotations.map(shape => {
      if (!shape || !['arrow','ellipse','text'].includes(shape.type) || !COLORS.includes(shape.color) ||
          !finite(shape.x,0,1) || !finite(shape.y,0,1)) invalid();
      const result = {type:shape.type,x:shape.x,y:shape.y,color:shape.color};
      if (shape.type === 'text') {
        if (!text(shape.text,160) || !shape.text.trim()) invalid();
        result.text = shape.text;
        if(shape.scale!==undefined){if(!finite(shape.scale,.4,3))invalid();result.scale=shape.scale;}
      } else {
        if (!finite(shape.x2,0,1) || !finite(shape.y2,0,1)) invalid();
        result.x2=shape.x2; result.y2=shape.y2;
      }
      return result;
    });
    return {id:photo.id,original:photo.original,thumbnail:photo.thumbnail,annotations,crop:normalizeCrop(photo.crop)};
  });
  const {original,thumbnail,annotations,crop}=photos[0];
  const category=normalizeCategory(record.category),categoryName=normalizeCategoryName(record.categoryName,category);
  return {id:record.id,createdAt:record.createdAt,project:record.project,description:record.description,
    address:{area:a.area,block:a.block,street:a.street},
    ...(manual===undefined?{}:{manualAddressFields:[...new Set(manual)]}),
    location:p === null ? null : {latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,timestamp:p.timestamp,...(p.pinSource?{pinSource:p.pinSource}:{})},
    photos,original,thumbnail,annotations,crop,stamp:normalizeStamp(record.stamp),
    category,categoryName,export:normalizeExport(record.export)};
}

async function packBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
  return {type:blob.type,data:btoa(binary)};
}

function unpackBlob(value,max,video=false) {
  if (!value || !(video?VIDEO_TYPES.includes(mediaType(value.type)):MIME_TYPES.includes(value.type)) || typeof value.data !== 'string' ||
      value.data.length > Math.ceil(max / 3) * 4 || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) {
    throw new Error('A media file in this backup is invalid.');
  }
  const binary = atob(value.data);
  const bytes = Uint8Array.from(binary, c=>c.charCodeAt(0));
  return new Blob([bytes],{type:value.type});
}

export async function encodeBackup(records) {
  if(!Array.isArray(records) || records.length>500)throw new Error('A backup can contain at most 500 notes.');
  const clean = records.map(validateRecord);
  if(new Set(clean.map(r=>r.id)).size!==clean.length)throw new Error('This backup contains duplicate IDs.');
  const estimate = clean.reduce((n,r)=>n+r.photos.reduce((sum,p)=>sum+(p.original.size+p.thumbnail.size)*4/3+20000,0),0);
  if(estimate > MAX_BACKUP_BYTES) throw new Error('The library exceeds the 64 MB backup limit. Back up notes individually.');
  const packed = [];
  for (const r of clean) {
    const {original,thumbnail,annotations,crop,photos,...metadata}=r;
    const images=[];
    for(const photo of photos)images.push({...photo,original:await packBlob(photo.original),thumbnail:await packBlob(photo.thumbnail)});
    packed.push({...metadata,photos:images});
  }
  const version=clean.some(record=>record.photos.some(isVideo))?4:3;
  const json=JSON.stringify({app:'rasd',version,kind:'notes',exportedAt:new Date().toISOString(),records:packed});
  if(new Blob([json]).size>MAX_BACKUP_BYTES) throw new Error('This backup exceeds 64 MB. Back up notes individually.');
  return json;
}

export async function decodeBackup(json) {
  if (typeof json !== 'string' || new Blob([json]).size > MAX_BACKUP_BYTES) throw new Error('This file exceeds the 64 MB import limit.');
  let data;
  try {data=JSON.parse(json);} catch {throw new Error('This is not a valid backup file.');}
  if(data?.app !== 'rasd' || !(data.version===1 || ([3,4].includes(data.version) && data.kind==='notes')) || !Array.isArray(data.records) || data.records.length > 500) {
    throw new Error('Unsupported backup format.');
  }
  const ids = new Set();
  return data.records.map(r=>{
    if(!r || typeof r!=='object')throw new Error('Invalid backup note.');
    if(data.version<4 && (isVideo(r) || (Array.isArray(r.photos) && r.photos.some(isVideo))))throw new Error('Videos require backup version 4.');
    let photos;
    if(data.version===1)photos=[{id:'photo-1',original:unpackBlob(r.original,MAX_PHOTO_BYTES),thumbnail:unpackBlob(r.thumbnail,512*1024),annotations:r.annotations,crop:r.crop}];
    else {
      if(!Array.isArray(r.photos) || !r.photos.length || r.photos.length>MAX_NOTE_PHOTOS)throw new Error('Invalid backup photos.');
      photos=r.photos.map(p=>{
        if(!p || typeof p!=='object')throw new Error('Invalid backup photo.');
        const video=isVideo(p);
        return {...p,original:unpackBlob(p.original,video?MAX_VIDEO_BYTES:MAX_PHOTO_BYTES,video),thumbnail:unpackBlob(p.thumbnail,512*1024)};
      });
    }
    const clean=validateRecord({...r,photos});
    if(ids.has(clean.id)) throw new Error('This backup contains duplicate IDs. Your library has not changed.');
    ids.add(clean.id);
    return clean;
  });
}
