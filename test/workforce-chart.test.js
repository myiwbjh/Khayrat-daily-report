import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWorkforceChart} from '../src/workforce-chart.js';

test('renders stacked personnel bars, a labelled total line and review warning',()=>{
 const html=renderWorkforceChart([{date:'2026-07-06',chinese:54,local:19,total:73,needsReview:true},{date:'2026-07-10',chinese:51,local:19,total:70,needsReview:true}]);
 assert.match(html,/rect class="cn"/);assert.match(html,/rect class="local"/);assert.match(html,/class="total-line"/);assert.match(html,/>73⚠</);assert.match(html,/人员数据待复核/);
 const path=html.match(/class="total-line" d="([^"]*)"/)[1];assert.equal((path.match(/M/g)||[]).length,2);assert.equal((path.match(/L/g)||[]).length,0);
});

test('does not turn missing personnel into zero-height data marks',()=>{
 const html=renderWorkforceChart([{date:'2026-07-06',chinese:null,local:null,total:null,needsReview:false}]);
 assert.doesNotMatch(html,/rect class=/);assert.doesNotMatch(html,/total-dot/);
});
