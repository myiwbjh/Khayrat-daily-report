import test from 'node:test';
import assert from 'node:assert/strict';
import {renderProgressChart} from '../src/progress-chart.js';
import {renderWorkforceChart} from '../src/workforce-chart.js';

test('monthly columns use a shared right-axis linear scale without changing real percentages',()=>{
  const chart=renderProgressChart([
    {date:'2026-09-30',planned:4,actual:2,plannedMonthly:4,actualMonthly:2},
    {date:'2026-10-31',planned:12,actual:8,plannedMonthly:8,actualMonthly:6},
    {date:'2026-11-30',planned:24,actual:null,plannedMonthly:12,actualMonthly:null}
  ]);
  const plan=[...chart.matchAll(/<rect class="monthly-plan"[^>]* height="([0-9.]+)"/g)].map(v=>Number(v[1]));
  const actual=[...chart.matchAll(/<rect class="monthly-actual"[^>]* height="([0-9.]+)"/g)].map(v=>Number(v[1]));
  assert.equal(plan.length,3);
  assert.equal(actual.length,2);
  assert.ok(Math.abs(plan[1]/plan[0]-2)<1e-7);
  assert.ok(Math.abs(plan[2]/plan[0]-3)<1e-7);
  assert.ok(Math.abs(actual[0]/plan[0]-.5)<1e-7);
  assert.match(chart,/class="axis-label right-axis"[^>]*>15%<\/text>/);
  assert.match(chart,/月度计划增量 12\.0%/);
  assert.doesNotMatch(chart,/月度实际增量 0\.0%/);
});

test('workforce labels have layout clearance and do not synthesize missing totals',()=>{
  const svg=renderWorkforceChart([{date:'2026-10-10',total:112,chinese:70,local:42},{date:'2026-10-11',total:null,chinese:null,local:null}]);
  assert.match(svg,/viewBox="0 0 560 210"/);
  assert.match(svg,/>112<\/text>/);
  assert.equal((svg.match(/class="total-label"/g)||[]).length,1);
});
