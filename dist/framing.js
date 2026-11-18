export function normalizeRatio(value='original') {
  if(!['original','16:9'].includes(value))throw new Error('Invalid photo ratio.');
  return value;
}
export function normalizeCrop(value={ratio:'original'}) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid photo crop.');
  return {ratio:normalizeRatio(value.ratio)};
}
export function cropRect(width,height,crop) {
  const {ratio}=normalizeCrop(crop);
  if(ratio==='original')return {x:0,y:0,width,height};
  const [a,b]=width>=height?[16,9]:[9,16];
  const unit=Math.floor(Math.min(width/a,height/b));
  if(unit<1)throw new Error('This photo is too small for 16:9. Choose Original.');
  const w=a*unit,h=b*unit;
  return {x:Math.floor((width-w)/2),y:Math.floor((height-h)/2),width:w,height:h};
}
