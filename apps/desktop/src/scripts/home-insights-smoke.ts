import assert from "node:assert/strict";
import type { AlbumGroup, HomeListeningResponse } from "@music-os/core";
import { buildHomeInsights } from "../renderer/ui/home-insights-data.js";

const albums = [{ files: [
  { id:'a',playCount:7,liked:true,rating:5,displayTags:{genre:'Rock; Pop; rock',year:'1999'} },
  { id:'b',playCount:2,liked:false,rating:1,displayTags:{genre:'Rock',date:'2004-01-01'} },
  { id:'c',playCount:0,displayTags:{genre:'Jazz',year:'2020'} }
] }] as unknown as AlbumGroup[];
const listening: HomeListeningResponse = {since:'2026-09-01T00:00:00Z',until:'2026-09-05T00:00:00Z',days:[],hours:[],recent:[],files:[
  {fileId:'a',plays:4,listenedMs:100,skips:1,firstPlayedAt:'2026-01-01T00:00:00Z'},
  {fileId:'b',plays:2,listenedMs:100,skips:0,firstPlayedAt:'2026-09-01T00:00:00Z'},
  {fileId:'unmapped',plays:1,listenedMs:100,skips:0,firstPlayedAt:'2026-09-02T00:00:00Z'}
]};
const result=buildHomeInsights(albums,listening);
assert.equal(result.firsts,2,'First recorded tracks include exact cutoff and ungrouped history');
assert.equal(result.repeats,5,'One first play per newly heard track; all later plays are returns');
assert.equal(result.skips,1);
assert.equal(result.taggedPlays,6,'Unknown metadata stays outside genre denominator');
assert.equal(result.genres.find(row=>row.label.toLowerCase()==='rock')!.weight,4,'Deduplicate case and split multi-tag plays');
assert(Math.abs(result.genres.reduce((sum,row)=>sum+row.percent,0)-100)<1e-9);
assert.deepEqual(result.decades,[{decade:1990,count:4},{decade:2000,count:2}]);
assert.equal(result.explored,2);
assert.equal(result.liked,1);
assert.equal(result.rated,2);
const empty=buildHomeInsights([], {...listening,files:[]});
assert.equal(empty.coverage,0);
assert.equal(empty.firsts,0);
assert.deepEqual(empty.genres,[]);
console.log('Home insight smoke passed: genre weighting, metadata coverage, eras, firsts/returns, explicit preferences and empty data.');