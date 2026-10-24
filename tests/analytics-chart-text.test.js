'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('chart text follows light/dark themes without changing layout or data', () => {
  const source = fs.readFileSync(require.resolve('../public/js/analytics/page'), 'utf8');
  let theme = 'dark', onThemeChange;
  const nodes = new Map(), charts = [];
  const context = { charts, config:{gpaCharts:['gpa']}, GpaFormat:require('../public/js/gpa-format'),
    document:{documentElement:{getAttribute:()=>theme},createElement:()=>({}),getElementById(id){
      if(!nodes.has(id)) nodes.set(id,{style:{},parentNode:{classList:{contains:()=>true}},appendChild(){}});
      return nodes.get(id);
    }}, getComputedStyle:()=>({getPropertyValue:()=>theme==='dark'?'#CBD5E1':'#4B5563'}),
    MutationObserver:class {constructor(callback){onThemeChange=callback;}observe(){}},
    Chart:class {constructor(canvas,spec){Object.assign(this,spec);this.updates=[];}update(mode){this.updates.push(mode);}}
  };
  vm.runInNewContext(source.slice(source.indexOf('    function chartTextColor()'),source.indexOf('    async function load()')),context);
  const data=[{label:'Stored GPA',data:[7,null,0]}];
  context.chart('gpa',['One','Two','Three'],data);
  const chart=charts[0];
  assert.equal(chart.type,'bar');
  assert.equal(chart.options.indexAxis,undefined);
  assert.equal(chart.options.scales.x.ticks.color,'#CBD5E1');
  assert.equal(chart.options.scales.y.ticks.color,'#CBD5E1');
  assert.equal(chart.options.plugins.legend.labels.color,'#CBD5E1');
  assert.equal(chart.options.scales.y.ticks.callback(0),'0.00');
  theme='light';onThemeChange();
  assert.equal(chart.options.scales.x.ticks.color,'#4B5563');
  assert.equal(chart.options.scales.y.ticks.color,'#4B5563');
  assert.equal(chart.options.plugins.legend.labels.color,'#4B5563');
  assert.deepEqual(chart.updates,['none']);
  assert.deepEqual(chart.data.datasets[0].data,[7,null,0]);
});
