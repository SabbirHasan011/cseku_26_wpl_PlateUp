const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {viewDOM}=require('./helpers/view-dom.cjs');
const {loadModules}=require('./helpers/frontend-modules.cjs');

test('item pricing UI uses the minimum, links CSV to the item, selects explicit training sources and labels demos',async()=>{
  const dom=viewDOM(),calls=[],errors=[];
  const item={id:12,title:'<Food>',category:'Bakery',original_price:200,minimum_price:60,rescue_price:90,
    offer_start_time:'20:00',offer_end_time:'01:00',pricing_source:'synthetic_model',daily_status:'Active'};
  const context=vm.createContext({document:dom.document,location:{protocol:'http:',port:'5000'},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},FormData,Blob,console,alert:message=>errors.push(message),URL,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    fetch:async(url,options={})=>{
      if(url.startsWith('/frontend/'))return {ok:true,headers:{get:()=> 'text/html'},text:async()=>fs.readFileSync(path.join(__dirname,'..',url),'utf8')};
      calls.push({url,options});
      let body;
      if(url.endsWith('/pricing'))body={item,model:{source:'synthetic',trained_at:'2026-10-01',artifact:{rows:180,test_rows:36,mae_portions:3,
        baseline_mae_portions:6,reason:'Passed baseline check.',algorithm:'Ridge'}},platform_count:0,imported:[{data_source:'synthetic',records:180}]};
      else if(url.includes('/import?'))body={count:30};
      else if(url.endsWith('/sample'))body={csv:'synthetic CSV'};
      else if(url.endsWith('/train'))body={message:'Model trained.'};
      else body={ '/api/business/listings':[item],'/api/orders':[], '/api/business/analytics':{summary:{},sales:[]},
        '/api/business/predictions':[], '/api/categories':[{name:'Bakery'}],'/api/listings':[], '/api/reviews':[] }[url];
      if(body===undefined)throw new Error('Unexpected API '+url);
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>body};
    }
  });
  await loadModules(context);await context.ensureView('dialogs');await context.ensureView('business');
  context.state.currentUser={id:1,name:'Kitchen',role:'business'};context.state.profile={business_name:'Kitchen'};
  context.state.token='owner';context.state.businessListings=[item];
  await context.openEditListingModal(12);
  assert.equal(Number(dom.document.getElementById('m-rescue-price').value),60,'Editor must show the floor, not the effective price');
  dom.document.getElementById('m-rescue-price').value='161';
  await context.submitNewListing();assert.match(dom.document.getElementById('listing-feedback').textContent,/80%/);
  await context.openItemPricing(12);
  assert.match(dom.document.getElementById('pricing-metrics').innerHTML,/Synthetic demonstration/);
  assert.match(dom.document.getElementById('pricing-summary').innerHTML,/160(?![\d.])/);
  assert.match(context.foodCard(item),/Demo model price/);
  dom.document.getElementById('pricing-file').files=[{size:80,text:async()=> 'CSV'}];
  await context.importItemHistory();
  assert.ok(calls.some(c=>c.url==='/api/business/training-data/import?listing_id=12'&&c.options.body==='CSV'));
  dom.document.getElementById('pricing-source').value='restaurant';
  await context.trainItemModel();
  assert.ok(calls.some(c=>c.url.endsWith('/12/train')&&JSON.parse(c.options.body).source==='restaurant'));
  await context.useItemSample();assert.equal(dom.document.getElementById('pricing-source').value,'synthetic');
  assert.ok(calls.some(c=>c.url.includes('listing_id=12')&&c.options.body==='synthetic CSV'));
  assert.deepEqual(errors,[]);
});
