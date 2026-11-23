const GOOD_ACCURACY = 20;
const SHARE_ACCURACY = 50;
const REFINE_TIME = 8000;
const OPTIONS = {enableHighAccuracy:true, timeout:12000, maximumAge:0};

export function validCoordinates(point) {
  return !!point && Number.isFinite(point.latitude) && Math.abs(point.latitude)<=90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude)<=180;
}

export function locationNeedsReview(point) {
  return !!point && point.accuracy>SHARE_ACCURACY && !point.pinSource;
}

export function parseCoordinates(text) {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,،]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(text);
  const point = match && {latitude:Number(match[1]), longitude:Number(match[2])};
  if(!validCoordinates(point))throw new Error('Enter valid latitude, longitude coordinates.');
  return point;
}

export function collectLocation(geo,{signal,onRefine=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    const started = Date.now();
    let best, watchId, timer, settled = false;
    function finish(error) {
      if(settled)return;
      settled = true;
      clearTimeout(timer);
      if(watchId!==undefined)geo.clearWatch(watchId);
      signal?.removeEventListener('abort',abort);
      if(error)reject(error);
      else if(best)resolve(best);
      else reject(new Error('No fresh location was found.'));
    }
    const abort = () => finish(signal.reason);
    function sample(position) {
      if(settled)return;
      const {latitude,longitude,accuracy}=position.coords;
      const timestamp=position.timestamp;
      if(!validCoordinates({latitude,longitude}) || !Number.isFinite(accuracy) || accuracy<0 || accuracy>100000 ||
        !Number.isFinite(timestamp) || timestamp<started-2000 || timestamp>Date.now()+2000)return;
      if(!best || accuracy<best.accuracy)best={latitude,longitude,accuracy,timestamp:new Date(timestamp).toISOString()};
      if(best.accuracy<=GOOD_ACCURACY)finish();
    }
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    geo.getCurrentPosition(position=>{
      if(settled)return;
      sample(position);
      if(settled)return;
      if(typeof geo.watchPosition!=='function' || typeof geo.clearWatch!=='function'){finish();return;}
      onRefine(best);
      timer=setTimeout(()=>finish(),REFINE_TIME);
      watchId=geo.watchPosition(sample,error=>finish(error.code===1 || !best?error:undefined),OPTIONS);
      if(settled)geo.clearWatch(watchId);
    },finish,OPTIONS);
  });
}
