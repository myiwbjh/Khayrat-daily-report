import test from 'node:test';
import assert from 'node:assert/strict';
import {renderProgressChart} from '../src/progress-chart.js';

test('renders cumulative curves and monthly increment bars without filling missing actuals',()=>{
 const html=renderProgressChart([
  {date:'2026-09-30',planned:20,actual:15,plannedMonthly:20,actualMonthly:15},
  {date:'2026-10-31',planned:40,actual:null,plannedMonthly:20,actualMonthly:null}
 ]);
 assert.match(html,/class="plan-line"/);assert.match(html,/class="actual-line"/);
 assert.equal((html.match(/class="monthly-plan"/g)||[]).length,2);
 assert.equal((html.match(/class="monthly-actual"/g)||[]).length,1);
 assert.match(html,/月度实际增量 15\.0%/);assert.match(html,/class="date-grid"/);
 assert.match(html,/right-axis/);assert.match(html,/>100%<\/text>/);
});
