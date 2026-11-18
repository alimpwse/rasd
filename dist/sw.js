const CACHE='rasd-shell-v16';
// The host redirects /index.html to /. Replaying that followed response for a
// navigation (redirect mode "manual") is rejected by Safari and Chromium.
const FILES=['./','./styles.css','./app.js','./report-ui.js','./report.js','./pdf.js','./camera.js','./video.js','./video-capture.js','./editor.js','./fonts.js','./backup.js','./fonts/IBMPlexSansArabic-Regular.woff2','./fonts/IBMPlexSansArabic-Medium.woff2','./fonts/IBMPlexSansArabic-SemiBold.woff2','./framing.js','./datetime.js','./model.js','./storage.js','./drafts.js','./phrases.js','./stamp.js','./projects.js','./library.js','./preferences.js','./categories.js','./address.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(FILES.map(path=>new Request(new URL(path,self.registration.scope),{redirect:'error',cache:'reload'})));
  // Recover the two broken releases without needing their inaccessible update
  // button. Activation never reloads an open unsaved draft.
  // Later shell versions retain the normal explicit-update workflow.
  const previous=(await caches.keys()).filter(key=>key.startsWith('rasd-shell-') && key!==CACHE);
  if(previous.every(key=>['rasd-shell-v1','rasd-shell-v2'].includes(key)))await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('rasd-shell-') && key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate') {
    // HTML and modules must come from the same active shell until update acceptance.
    event.respondWith(caches.open(CACHE).then(cache=>cache.match('./')).then(cached=>cached || fetch(event.request)));
    return;
  }
  if(FILES.some(path=>new URL(path,self.registration.scope).href===url.href)) {
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached || fetch(event.request)));
  }
});
