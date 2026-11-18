// Photon/OSM suggests a nearby address. It is not an official PACI address service.
const CACHE_KEY='rasd-address-cache-v1',TTL=7*86400000;
const clean=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max):'';
const digits=value=>value.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776));
const blockPattern=/(?:\bblock\s*|(?:ال)?قطعة\s*(?:رقم\s*)?)([0-9٠-٩۰-۹]+[A-Za-z]?)(?=$|[\s,،-])/iu;
function distance(a,b) {
  const rad=Math.PI/180,dlat=(b[1]-a.latitude)*rad,dlon=(b[0]-a.longitude)*rad;
  return 12742000*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2));
}
export function parseAddress(data,point) {
  const feature=data?.features?.[0],p=feature?.properties,c=feature?.geometry?.coordinates;
  if(!p)throw new Error('No nearby address found. Enter it manually.');
  if(p.countrycode?.toUpperCase()!=='KW')throw new Error('Automatic address lookup is available in Kuwait. Enter the address manually.');
  if(!Array.isArray(c) || c.length<2 || !c.every(Number.isFinite) || distance(point,c)>250)throw new Error('No nearby address found. Enter it manually.');
  const locality=clean(p.locality),district=clean(p.district);
  const match=[locality,district,p.type==='locality'?clean(p.name):''].map(x=>x.match(blockPattern)).find(Boolean);
  const area=[district,clean(p.county),clean(p.city),locality.replace(blockPattern,'').replace(/[\s,،-]+$/u,'')].find(x=>x && !blockPattern.test(x)) || '';
  const street=clean(p.street || (p.type==='street' || p.osm_key==='highway'?p.name:''));
  const address={area,block:match?digits(match[1]):'',street:street.replace(/^(?:Street\s+|شارع\s+)/iu,'')};
  if(!Object.values(address).some(Boolean))throw new Error('No nearby address found. Enter it manually.');
  return address;
}
export class AddressLookup {
  constructor({storage,fetcher=globalThis.fetch,online=()=>globalThis.navigator?.onLine!==false}={}) {
    this.fetcher=(...args)=>fetcher(...args);this.online=online;this.cache={};this.lastRequest=0;this.tail=Promise.resolve();
    try {
      this.storage=storage || window.localStorage;
      const cached=JSON.parse(this.storage.getItem(CACHE_KEY));
      if(cached && typeof cached==='object' && !Array.isArray(cached))this.cache=cached;
    }catch{}
  }
  async lookup(point,{signal}={}) {
    if(!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude<28.5 || point.latitude>30.2 || point.longitude<46.5 || point.longitude>49)throw new Error('Automatic address lookup is available in Kuwait. Enter the address manually.');
    if(!Number.isFinite(point.accuracy) || point.accuracy>100)throw new Error('A more precise GPS position is needed for the address. Try outdoors or enter it manually.');
    const key=`${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    const run=async()=>{
      signal?.throwIfAborted();
      const cached=this.cache?.[key];
      if(cached && Date.now()-cached.time<TTL && ['area','block','street'].every(k=>typeof cached.address?.[k]==='string'))return {...cached.address};
      if(!this.online())throw new Error('Offline. GPS is saved; enter the address manually.');
      // No polling or background tracking. Serialize lookups and limit repeated taps.
      const wait=Math.max(0,3000-(Date.now()-this.lastRequest));
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      signal?.throwIfAborted();this.lastRequest=Date.now();
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,8000);
      try {
        const url=new URL('https://photon.komoot.io/reverse');
        url.search=new URLSearchParams({lat:String(point.latitude),lon:String(point.longitude),lang:'en',limit:'1',radius:'0.2'});
        const response=await this.fetcher(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'strict-origin'});
        if(!response.ok)throw new Error('Address service is unavailable. GPS is saved; enter the address manually.');
        const address=parseAddress(await response.json(),point);
        signal?.throwIfAborted();
        this.cache[key]={time:Date.now(),address};
        this.cache=Object.fromEntries(Object.entries(this.cache).filter(([,v])=>Date.now()-v?.time<TTL).sort((a,b)=>b[1].time-a[1].time).slice(0,100));
        try {this.storage?.setItem(CACHE_KEY,JSON.stringify(this.cache));}catch{}
        return {...address};
      } catch(error) {
        if(signal?.aborted)throw error;
        if(error.name==='AbortError' || error instanceof TypeError)throw new Error('Address lookup did not finish. GPS is saved; enter the address manually.');
        throw error;
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    };
    const pending=this.tail.then(run);this.tail=pending.catch(()=>{});return pending;
  }
}
