import test from 'node:test';
import assert from 'node:assert/strict';
import {Preferences} from '../dist/preferences.js';
import {parseAddress,AddressLookup} from '../dist/address.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};};
const point={latitude:29.333,longitude:48.083,accuracy:12};
const result=(props={},coords=[48.0828987,29.3329439])=>({features:[{geometry:{type:'Point',coordinates:coords},properties:{countrycode:'KW',district:'Salmiya',locality:'Salmiya - Block 6',street:'Al-Khansa Street',...props}}]});
test('defaults survive reload and are copied independently for each photo',()=>{
 const storage=memory(),p=new Preferences(storage),first=p.snapshot();
 assert.equal(first.stamp.mode,'strip');assert.equal(first.stamp.location,true);
 p.save({...first,stamp:{...first.stamp,mode:'overlay',time:false},export:{includeText:false}});
 const next=new Preferences(storage).snapshot();assert.equal(next.stamp.mode,'overlay');assert.equal(next.export.includeText,false);
 next.stamp.mode='off';assert.equal(p.snapshot().stamp.mode,'overlay');assert.equal(first.stamp.mode,'strip');
});
test('damaged or blocked preferences do not prevent capture and persistence failure is visible',()=>{
 assert.equal(new Preferences({getItem:()=>'{broken'}).snapshot().stamp.mode,'strip');
 const p=new Preferences({getItem:()=>null,setItem:()=>{throw new Error('blocked');}});
 assert.throws(()=>p.save({...p.snapshot(),autoAddress:false}),/session/);assert.equal(p.snapshot().autoAddress,false);
});
test('real Kuwait provider shapes yield area, labelled block and street',()=>{
 assert.deepEqual(parseAddress(result(),point),{area:'Salmiya',block:'6',street:'Al-Khansa Street'});
 assert.deepEqual(parseAddress(result({district:'Rabiya',locality:'Block 4',street:undefined,type:'street',name:'Street 2'}),point),{area:'Rabiya',block:'4',street:'2'});
 assert.equal(parseAddress(result({locality:'الزهراء - قطعة ١',district:'الزهراء'}),point).block,'1');
});
test('never invents block from house number/postcode or uses a building name as street',()=>{
 const a=parseAddress(result({locality:'Salmiya',street:undefined,type:'house',name:'Building 18',housenumber:'18',postcode:'20006'}),point);
 assert.deepEqual(a,{area:'Salmiya',block:'',street:''});
 assert.throws(()=>parseAddress(result({countrycode:'SA'}),point),/Kuwait/);
 assert.throws(()=>parseAddress(result({},[48.5,29.8]),point),/nearby/);
 assert.throws(()=>parseAddress({features:[]},point),/address/);
});
test('lookup caches successfully resolved coordinates and uses them offline',async()=>{
 const storage=memory();let online=true,calls=0;
 const lookup=new AddressLookup({storage,online:()=>online,fetcher:async url=>{calls++;assert.equal(new URL(url).origin,'https://photon.komoot.io');return new Response(JSON.stringify(result()));}});
 const a=await lookup.lookup(point);assert.equal(a.block,'6');online=false;
 assert.deepEqual(await lookup.lookup(point),a);assert.equal(calls,1);
 const reopened=new AddressLookup({storage,online:()=>false});assert.deepEqual(await reopened.lookup(point),a);
 await assert.rejects(()=>reopened.lookup({...point,latitude:29.31}),/Offline/);
});
test('failed provider and poor GPS retain manual fallback; no low-accuracy network request',async()=>{
 let calls=0;const lookup=new AddressLookup({storage:memory(),fetcher:async()=>{calls++;return new Response('unavailable',{status:503});}});
 await assert.rejects(()=>lookup.lookup({...point,accuracy:250}),/precise/);assert.equal(calls,0);
 await assert.rejects(()=>lookup.lookup(point),/unavailable/);assert.equal(calls,1);
});
test('malformed cache root never prevents a fresh valid address lookup',async()=>{
 for(const damaged of ['true','12','"damaged"','[]']) {
  const lookup=new AddressLookup({storage:{getItem:()=>damaged,setItem:()=>{}},fetcher:async()=>new Response(JSON.stringify(result()))});
  assert.equal((await lookup.lookup(point)).block,'6');
 }
});
