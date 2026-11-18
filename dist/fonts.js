export const PHOTO_FONT='"IBM Plex Sans Arabic", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
let ready;
export function ensurePhotoFonts(){
  if(typeof document==='undefined' || !document.fonts)return Promise.resolve();
  if(!ready)ready=Promise.all([400,500,600].map(weight=>document.fonts.load(`${weight} 24px "IBM Plex Sans Arabic"`,'ملاحظة عربية'))).catch(error=>{ready=null;throw error;});
  return ready;
}
