import test from 'node:test';import assert from 'node:assert/strict';import {price,deadline,isotonic,analyze,quantile,densityIntervals} from '../src/model.mjs';
const now=Date.parse('2026-11-13T23:39:00Z');const market=(s,b,a,extra={})=>({ticker:'KXFAAGROUNDSTOPLIFT-13NOV26-'+s,yes_bid_dollars:String(b),yes_ask_dollars:String(a),status:'active',...extra});const data=markets=>({markets});
test('cutoff uses immutable ticker, not early close time',()=>assert.equal(deadline(market('14NOV260000',.4,.6,{close_time:'2026-11-13T23:50:00Z'})),Date.parse('2026-11-14T05:00:00Z')));
test('dollars, legacy cents, missing quotes',()=>{assert.equal(price({yes_bid_dollars:'0.4200'},'yes_bid'),.42);assert.equal(price({yes_bid:42},'yes_bid'),.42);assert.equal(price({yes_bid:null},'yes_bid'),null);});
test('weighted monotonic correction pools violations',()=>isotonic([.2,.6,.4,.9],[1,1,3,1]).forEach((v,i)=>assert.ok(Math.abs(v-[.2,.45,.45,.9][i])<1e-12)));
test('median interpolation and open-ended quantile',()=>{const a=analyze(data([market('14NOV260000',.47,.51),market('14NOV260300',.63,.74)]),now);assert.ok(Math.abs(a.median.time-Date.parse('2026-11-14T05:00:00Z')-3*3600000*.01/.195)<1);assert.equal(quantile(a.points,.9).edge,'after');assert.ok(Math.abs(a.tail-.315)<1e-12);});
test('missing or crossed quotes cannot fabricate forecast',()=>{const a=analyze(data([market('14NOV260000',.6,.4),market('14NOV260300',0,1)]),now);assert.ok(a.error);assert.equal(a.points.length,0);});
test('settled YES yields interval, not false precise ETA',()=>{const a=analyze(data([market('13NOV262300',0,0,{result:'no',status:'finalized'}),market('14NOV260000',1,1,{result:'yes',status:'finalized'})]),now);assert.equal(a.settled,true);assert.equal(a.latest-a.earliest,3600000);});
test('a past cutoff alone does not invalidate an active quote or imply settlement',()=>{
  const a=analyze(data([market('13NOV261800',.1,.2),market('14NOV260000',.3,.4,{status:'closed'}),market('14NOV260300',.6,.7),market('14NOV260600',.8,.9)]),now);
  assert.equal(a.points.length,3);
  assert.ok(Math.abs(a.rows[0].fitted-.15)<1e-12);
  assert.equal(a.rows[1].fitted,undefined);
  assert.equal(a.settlementCount,0);
});
test('known outcomes are exact hard constraints even when quotes disagree',()=>{
  const a=analyze(data([
    market('13NOV261800',.4,.5),
    market('13NOV261900',.2,.3,{result:'no',status:'finalized'}),
    market('13NOV262000',.4,.6),
    market('13NOV262100',.7,.8,{result:'yes',status:'finalized'}),
    market('13NOV262200',.8,.9),
  ]));
  assert.deepEqual(a.points.map(p=>p.p),[0,0,.5,1,1]);
  for(const p of a.points) assert.ok(p.low<=p.p && p.p<=p.high);
  assert.deepEqual(a.points.filter(p=>p.result).map(p=>[p.low,p.high]),[[0,0],[1,1]]);
  assert.equal(a.quoteCount,3); assert.equal(a.settlementCount,2);
});
test('no artificial boundary: a single quote provides bounds, not a precise median',()=>{
  const a=analyze(data([market('14NOV260000',.8,.9)]));
  assert.equal(a.points.length,1); assert.equal(a.median.edge,'before');
  assert.equal(quantile(a.points,.9).edge,'after'); assert.equal(a.restricted,null);
  assert.deepEqual(a,analyze(data([market('14NOV260000',.8,.9)]),now+3600000));
});
test('settlement-only snapshots remain usable and interpolate within known bounds',()=>{
  const a=analyze(data([market('13NOV262300',0,0,{result:'no',status:'finalized'}),market('14NOV260000',1,1,{result:'yes',status:'finalized'})]));
  assert.equal(a.median.edge,null); assert.equal(a.median.time,(a.earliest+a.latest)/2);
  assert.equal(a.restricted,a.median.time); assert.equal(a.tail,0); assert.equal(a.quoteCount,0);
});
test('an unknown lower tail cannot produce a finite mean',()=>{
  const a=analyze(data([market('13NOV262300',.49,.51),market('14NOV260000',.99,1)]));
  assert.equal(a.restricted,null);
});
test('contradictory cumulative settlements fail instead of generating a curve',()=>{
  const a=analyze(data([market('13NOV262300',1,1,{result:'yes'}),market('14NOV260000',0,0,{result:'no'})]));
  assert.match(a.error,/Conflicting/); assert.deepEqual(a.points,[]);
});

test('density respects interval widths and integrates to the observed CDF increase',()=>{
  const intervals=densityIntervals([{t:0,p:.1},{t:1800000,p:.3},{t:9000000,p:.7}]);
  assert.ok(Math.abs(intervals[0].perHour-.4)<1e-12);
  assert.ok(Math.abs(intervals[1].perHour-.2)<1e-12);
  const area=intervals.reduce((sum,p)=>sum+p.perHour*(p.end-p.start)/3600000,0);
  assert.ok(Math.abs(area-.6)<1e-12); // Unobserved 40% is not normalized away.
});
test('raw density preserves negative slopes rather than clipping them into a PDF',()=>{
  const intervals=densityIntervals([{t:0,p:.8},{t:3600000,p:.3},{t:7200000,p:.9}]);
  assert.equal(intervals[0].perHour,-.5);
  assert.ok(Math.abs(intervals.reduce((s,p)=>s+p.mass,0)-.1)<1e-12);
  assert.deepEqual(densityIntervals([{t:0,p:.8}]),[]);
  assert.throws(()=>densityIntervals([{t:1,p:0},{t:1,p:1}]),/increasing deadlines/);
});
