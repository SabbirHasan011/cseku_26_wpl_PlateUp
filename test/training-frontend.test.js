const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {viewDOM}=require('./helpers/view-dom.cjs');
const {loadModules}=require('./helpers/frontend-modules.cjs');

test('business data screen checks history, validates before import, shows errors and isolates generated samples',async()=>{
  const dom=viewDOM(),calls=[],downloads=[];
  const originalCreate=dom.document.createElement;
  dom.document.createElement=tag=>tag==='a'?{click(){downloads.push(this.download);},remove(){}}:originalCreate(tag);
  dom.document.body.appendChild=()=>{};
  let validationFails=false;
  const context=vm.createContext({document:dom.document,location:{protocol:'http:',port:'5000'},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},FormData,Blob,console,alert(){},
    URL:{createObjectURL:()=> 'blob:sample',revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    fetch:async(url,options={})=>{
      if(url.startsWith('/frontend/'))return {ok:true,headers:{get:()=> 'text/html'},text:async()=>fs.readFileSync(path.join(__dirname,'..',url),'utf8')};
      calls.push({url,options});
      if(url.endsWith('/synthetic'))return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({csv:'labelled sample',count:6,seed:9})};
      if(url.includes('/import'))return {ok:!validationFails,status:validationFails?400:200,headers:{get:()=> 'application/json'},json:async()=>validationFails?
        {message:'Invalid CSV',errors:[{row:2,issues:['Invalid offer date.']}]}:{message:'Validated or saved',count:1}};
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({summary:{total:1,eligible:0,flagged:1,unfinished:1,synthetic:0},
        rows:[{offer_date:'2025-01-01',title:'<script>meal</script>',item_reference:'plateup:1',initial_quantity:10,collected_quantity:0,
          snapshot_quality:'captured',training_eligible:false,quality_issues:['Offer has not ended.']}]})};
    }
  });
  await loadModules(context);await context.ensureView('business');
  context.state.currentUser={id:1,role:'business'};context.state.token='business-session';
  await context.loadTrainingData();
  assert.match(dom.document.getElementById('training-summary').textContent,/1 records/);
  assert.match(dom.document.getElementById('training-rows').innerHTML,/&lt;script&gt;/);
  const file={size:100,text:async()=> 'test CSV'};
  dom.document.getElementById('training-file').files=[file];context.resetTrainingImport();
  const before=calls.length;await context.importTrainingFile(true);assert.equal(calls.length,before,'No import before validation');
  await context.importTrainingFile(false);assert.equal(dom.document.getElementById('training-import').disabled,false);
  assert.ok(calls.at(-1).url.endsWith('?dry_run=true'));assert.equal(calls.at(-1).options.headers['Content-Type'],'text/csv');
  await context.importTrainingFile(true);assert.equal(dom.document.getElementById('training-import').disabled,true);
  validationFails=true;await context.importTrainingFile(false);
  assert.match(dom.document.getElementById('training-import-feedback').textContent,/Row 2: Invalid offer date/);
  validationFails=false;
  dom.document.getElementById('training-seed').value='9';dom.document.getElementById('training-days').value='3';
  dom.document.getElementById('training-items').value='2';dom.document.getElementById('training-start').value='2025-01-01';
  const importsBefore=calls.filter(call=>call.url.includes('/import')).length;
  await context.generateTrainingSample();assert.equal(downloads.at(-1),'plateup-synthetic-seed-9.csv');
  assert.equal(calls.filter(call=>call.url.includes('/import')).length,importsBefore,'Generation only downloads');
  await context.saveTrainingSample();assert.equal(dom.document.getElementById('training-source').value,'synthetic');
  assert.equal(calls.filter(call=>call.url.includes('/import')).length,importsBefore+1);
  context.state.token='another-business';await context.loadTrainingData();
  assert.equal(dom.document.getElementById('training-save-sample').disabled,true);
  const requestCount=calls.length;await context.saveTrainingSample();assert.equal(calls.length,requestCount,'Samples cannot cross sessions');
});
