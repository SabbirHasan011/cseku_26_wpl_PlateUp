const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadModules}=require('./helpers/frontend-modules.cjs');
const {viewDOM}=require('./helpers/view-dom.cjs');

async function setup() {
  const dom=viewDOM(),calls=[],errors=[],storage=new Map();
  const context=vm.createContext({document:dom.document,location:{protocol:'http:',port:'5000',hash:''},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    console:{error:(...args)=>errors.push(args),warn:(...args)=>errors.push(args)},alert:message=>errors.push(message),
    FormData,URL,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    fetch:async(url)=>{
      calls.push(url);
      if(url.startsWith('/frontend/'))return {ok:true,headers:{get:()=> 'text/html'},text:async()=>fs.readFileSync(path.join(__dirname,'..',url),'utf8')};
      const responses={ '/api/listings':[], '/api/reviews':[], '/api/categories':[{id:1,name:'Bakery'}],'/api/cities':[{id:1,name:'Dhaka'}],
        '/api/orders':[], '/api/restaurants':[], '/api/notifications':{notifications:[],unread_count:0},
        '/api/favorites':{saved:[],restaurants:[],listings:[]}, '/api/business/listings':[],
        '/api/business/analytics':{summary:{active_listings:0,meals_rescued:0,revenue:0},sales:[]}, '/api/business/predictions':[] };
      if(!Object.hasOwn(responses,url))throw Error('Unexpected API '+url);
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>responses[url]};
    }
  });
  const modules=await loadModules(context);
  await Promise.all([context.ensureView('navbar'),context.ensureView('dialogs')]);
  return { ...dom,context,calls,errors,storage,modules };
}

test('views load on demand; cross-screen renderers tolerate absent DOM and cached forms retain values',async()=>{
  const ui=await setup(),c=ui.context;
  assert.equal(ui.document.getElementById('customer'),null);
  await c.loadInitialData();
  assert.equal(ui.document.getElementById('customer'),null,'Data loading must not mount every screen');
  assert.equal(await c.showScreen('customer'),true);
  ui.document.getElementById('food-search').value='unfinished search';
  assert.equal(await c.showScreen('login'),true);
  ui.document.getElementById('signup-name').value='Unfinished signup';
  await c.showScreen('customer');await c.showScreen('login');
  assert.equal(ui.document.getElementById('food-search').value,'unfinished search');
  assert.equal(ui.document.getElementById('signup-name').value,'Unfinished signup');
  assert.equal(ui.calls.filter(url=>url==='/frontend/views/auth.html').length,1);
  assert.equal(ui.calls.filter(url=>url==='/frontend/views/marketplace.html').length,1);
  assert.equal(ui.document.querySelectorAll('.screen').filter(n=>n.classList.contains('active')).length,1);
  assert.deepEqual(ui.errors,[]);
});

test('every existing screen initializes with the real partial IDs and role guards',async()=>{
  const ui=await setup(),c=ui.context;
  assert.equal(c.resolveScreen('business'),'login');
  assert.equal(c.resolveScreen('my-orders'),'login');
  assert.equal(c.resolveScreen('profile'),'login');
  assert.equal(c.resolveScreen('../server/index.js'),'home');
  c.state.currentUser={id:1,name:'Customer',role:'customer'};c.state.profile={name:'Customer',customer_city:'Dhaka'};
  for(const screen of ['home','customer','restaurants','my-orders','favorites','profile','recovery','reset-password']) assert.equal(await c.showScreen(screen),true,screen);
  c.state.currentUser={id:2,name:'Business',role:'business'};c.state.profile={business_name:'Test Kitchen'};
  assert.equal(await c.showScreen('business'),true);
  assert.equal(await c.showScreen('profile'),true);
  assert.equal(c.state.activeScreen,'business');
  c.switchBizTab('listings',ui.document.querySelector('[data-biz-tab]'));
  await c.openNewListingModal();
  assert.equal(ui.document.getElementById('m-start').value,'20:00');
  assert.equal(ui.document.getElementById('m-category').disabled,false);
  assert.deepEqual(ui.errors,[]);
});

test('view requests deduplicate, reject unknown paths, and retry failed fetches without blanking the current screen',async()=>{
  const ui=await setup(),c=ui.context;
  await c.showScreen('login');
  await assert.rejects(c.ensureView('../server/index.js'),/Unknown/);
  const fetch=c.fetch;
  let fail=true;
  c.fetch=async url=>url==='/frontend/views/profile.html'&&fail?{ok:false}:fetch(url);
  c.state.currentUser={id:1,name:'Customer',role:'customer'};c.state.profile={};
  assert.equal(await c.showScreen('profile'),false);
  assert.equal(ui.document.getElementById('login').classList.contains('active'),true);
  assert.equal(ui.document.getElementById('app-retry').hidden,false);
  fail=false;
  assert.equal(await c.retryNavigation(),true);
  assert.equal(ui.document.getElementById('app-status').hidden,true);
  await Promise.all([c.ensureView('restaurants'),c.ensureView('restaurants')]);
  assert.equal(ui.calls.filter(url=>url==='/frontend/views/restaurants.html').length,1);
});

test('a slow navigation cannot replace a newer screen or revive a previous session',async()=>{
  const ui=await setup(),c=ui.context,fetch=c.fetch;
  let release;
  c.fetch=async url=>{if(url==='/frontend/views/restaurants.html')await new Promise(resolve=>release=resolve);return fetch(url);};
  const old=c.showScreen('restaurants');
  await c.showScreen('login');release();await old;
  assert.equal(c.state.activeScreen,'login');
  c.fetch=async url=>{if(url==='/frontend/views/orders.html')await new Promise(resolve=>release=resolve);return fetch(url);};
  c.state.currentUser={id:1,role:'customer'};c.state.token='old-session';
  const privateScreen=c.showScreen('my-orders');
  c.state.token=null;c.state.currentUser=null;
  await c.showScreen('login');release();await privateScreen;
  assert.equal(c.state.activeScreen,'login');
});

test('delegated actions and keyboard/banner listeners are installed once and work on newly loaded markup',async()=>{
  const ui=await setup(),c=ui.context;
  c.installActions();c.installActions();c.installDialogKeyboard();c.installDialogKeyboard();
  await c.showScreen('home');await c.showScreen('login');await c.showScreen('home');
  for(const event of ['click','input','change','submit','keydown','home-banner:pointerenter','home-banner:pointerleave','visibilitychange']) assert.equal(ui.listenerCounts.get(event),1,event);
  const actionNode={dataset:{click:'showScreen',arg0:'login'}};
  ui.listeners.get('click')({target:{closest:()=>actionNode}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.activeScreen,'login');
  ui.listeners.get('click')({target:{closest:()=>({dataset:{click:'constructor'}})}});
  assert.deepEqual(ui.errors,[]);
});

test('signup, login, account restoration and logout retain their API contracts with lazy views',async()=>{
  const ui=await setup(),c=ui.context,fetch=c.fetch,requests=[];
  c.fetch=async(url,options={})=>{
    const profile={id:1,name:'Customer',email:'customer@example.test',role:'customer',customer_city:'Dhaka'};
    const values={'/api/auth/signup':{user:profile},'/api/auth/login':{token:'session-token'},'/api/me':{profile}};
    if(!Object.hasOwn(values,url))return fetch(url,options);
    requests.push({url,options});return {ok:true,headers:{get:()=> 'application/json'},json:async()=>values[url]};
  };
  await c.showScreen('login');
  ui.document.getElementById('signup-name').value='Customer';
  ui.document.getElementById('signup-email').value='customer@example.test';
  ui.document.getElementById('signup-pass').value='Password123!';
  ui.document.getElementById('signup-pass-confirm').value='Password123!';
  await c.handleSignup({preventDefault(){}});
  assert.equal(requests[0].url,'/api/auth/signup');
  assert.equal(JSON.parse(requests[0].options.body).role,'customer');
  ui.document.getElementById('login-pass').value='Password123!';
  await c.handleLogin({preventDefault(){}});
  assert.equal(c.state.activeScreen,'customer');
  assert.equal(ui.storage.get('plateup_token'),'session-token');
  assert.equal(c.state.currentUser.name,'Customer');
  assert.equal(ui.document.getElementById('profile'),null,'Login does not require mounting profile');
  c.state.currentUser=null;await c.loadAccount(true);
  assert.equal(c.state.currentUser.id,1);
  c.handleLogout();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.currentUser,null);assert.equal(ui.storage.has('plateup_token'),false);
  assert.equal(c.state.activeScreen,'home');
  assert.deepEqual(ui.errors,[]);
});

test('application bootstrap follows the URL instead of the saved screen and installs listeners/timers once',async()=>{
  const ui=await setup(),c=ui.context,intervals=[],focus=[];
  c.window={addEventListener:(...args)=>focus.push(args)};
  c.setInterval=(fn,ms)=>{intervals.push(ms);return intervals.length;};
  ui.storage.set('plateup_screen','login');
  const app=await ui.modules.bootstrap();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.activeScreen,'home');
  assert.deepEqual(intervals,[30000,15000]);
  assert.equal(focus.filter(([event])=>event==='focus').length,2);
  assert.equal(focus.filter(([event])=>event==='popstate').length,1);
  assert.equal(focus.filter(([event])=>event==='hashchange').length,1);
  await app.startApp();
  assert.deepEqual(intervals,[30000,15000]);
  assert.deepEqual(ui.errors,[]);
});

function attachBrowserHistory(ui,path='/',port='5000') {
  const c=ui.context,entries=[path],listeners=new Map();let index=0,pushes=0;
  function apply(url) {
    const value=new URL(url,'http://localhost:'+port);
    Object.assign(c.location,{pathname:value.pathname,search:value.search,hash:value.hash,port});
  }
  apply(path);
  c.window={addEventListener:(type,fn)=>listeners.set(type,fn)};
  c.history={
    pushState(state,title,url) {entries.splice(index+1);entries.push(url);index++;pushes++;apply(url);},
    replaceState(state,title,url) {entries[index]=url;apply(url);},
    async back(){if(index>0){apply(entries[--index]);await listeners.get('popstate')?.();}},
    async forward(){if(index<entries.length-1){apply(entries[++index]);await listeners.get('popstate')?.();}}
  };
  c.installPageHistory();
  return {entries,listeners,get pushes(){return pushes;}};
}

test('navigation gives pages and business tabs URLs; Back/Forward restore tabs without adding entries',async()=>{
  const ui=await setup(),c=ui.context,h=attachBrowserHistory(ui);
  c.state.currentUser={id:2,name:'Kitchen',role:'business'};c.state.profile={business_name:'Kitchen'};
  await c.showScreen('home');await c.showScreen('customer');assert.equal(c.location.pathname,'/browse-food');
  await c.showScreen('business');assert.equal(c.location.pathname,'/business');
  await c.switchBizTab('listings');assert.equal(c.location.pathname,'/business/listings');
  await c.switchBizTab('profile');assert.equal(c.location.pathname,'/business/profile');
  assert.equal(ui.document.getElementById('biz-tab-profile').style.display,'block');
  const pushes=h.pushes;await c.switchBizTab('profile');assert.equal(h.pushes,pushes,'Same tab does not add history');
  await c.history.back();assert.equal(c.location.pathname,'/business/listings');
  assert.equal(c.state.activeBusinessTab,'listings');assert.equal(ui.document.getElementById('biz-tab-profile').style.display,'none');
  assert.equal(ui.document.getElementById('biz-tab-overview').style.display,'none');
  assert.equal(ui.document.getElementById('biz-tab-listings').style.display,'block');
  assert.equal(ui.document.getElementById('business-mobile-tab').value,'listings');
  await c.history.forward();assert.equal(c.state.activeBusinessTab,'profile');assert.equal(h.pushes,pushes);
  await c.showScreen('home');await c.showScreen('profile');assert.equal(c.location.pathname,'/business/profile');
  await c.history.back();assert.equal(c.state.activeScreen,'home','Profile alias must not replace the previous page');
  assert.deepEqual(ui.errors,[]);
});

test('deep links survive startup and authentication; restaurant IDs and unknown routes stay controlled',async()=>{
  const ui=await setup(),c=ui.context;attachBrowserHistory(ui,'/business/profile');
  ui.storage.set('plateup_screen','customer');
  const app=await ui.modules.bootstrap();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.activeScreen,'login');assert.equal(c.location.pathname,'/login');
  c.state.currentUser={id:2,name:'Kitchen',role:'business'};c.state.profile={business_name:'Kitchen'};
  await c.navigateAfterLogin();assert.equal(c.location.pathname,'/business/profile');assert.equal(c.state.activeBusinessTab,'profile');
  c.location.pathname='/business/listings/';await c.navigateFromLocation();assert.equal(c.location.pathname,'/business/listings');
  c.state.currentUser={id:1,name:'Customer',role:'customer'};c.state.profile={customer_city:'Dhaka'};
  c.location.pathname='/business/profile';await c.navigateFromLocation();assert.equal(c.location.pathname,'/browse-food');
  const originalFetch=c.fetch;
  c.fetch=async(url,options)=>/^\/api\/restaurants\/\d+$/.test(url)?{ok:true,headers:{get:()=> 'application/json'},
    json:async()=>({restaurant:{id:Number(url.split('/').at(-1)),business_name:'Kitchen',city:'Dhaka'},listings:[]})}:originalFetch(url,options);
  c.location.pathname='/restaurants/12';await c.navigateFromLocation();assert.equal(c.state.selectedRestaurantId,12);
  await c.openRestaurant(13);assert.equal(c.location.pathname,'/restaurants/13');
  await c.history.back();assert.equal(c.state.selectedRestaurantId,12);assert.equal(c.state.selectedRestaurant.id,12);
  c.location.pathname='/business/../../server/index.js';await c.navigateFromLocation();assert.equal(c.location.pathname,'/');
  assert.deepEqual(ui.errors,[]);
});

test('Live Server keeps reloadable hash routes on its HTML entry point',async()=>{
  const ui=await setup(),c=ui.context;attachBrowserHistory(ui,'/frontend/index.html','5500');
  await c.showScreen('restaurants');assert.equal(c.location.pathname,'/frontend/index.html');assert.equal(c.location.hash,'#/restaurants');
  await c.showScreen('login');await c.history.back();assert.equal(c.state.activeScreen,'restaurants');
  assert.equal(c.location.hash,'#/restaurants');assert.deepEqual(ui.errors,[]);
});

test('a refreshed business profile URL restores the authenticated account before selecting its tab',async()=>{
  const ui=await setup(),c=ui.context;attachBrowserHistory(ui,'/business/profile');
  c.state.token='saved-session';ui.storage.set('plateup_screen','home');
  const originalFetch=c.fetch;
  c.fetch=async(url,options)=>url==='/api/me'?{ok:true,headers:{get:()=> 'application/json'},json:async()=>({
    profile:{id:2,name:'Kitchen',role:'business',business_name:'Kitchen'}})}:originalFetch(url,options);
  await ui.modules.bootstrap();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.state.activeScreen,'business');assert.equal(c.state.activeBusinessTab,'profile');
  assert.equal(c.location.pathname,'/business/profile');
  assert.equal(ui.document.getElementById('biz-tab-profile').style.display,'block');
  assert.deepEqual(ui.errors,[]);
});

test('business overview uses API daily totals, separates the menu, and exposes item history and quantity shortcuts',async()=>{
  const ui=await setup(),c=ui.context,fetch=c.fetch;
  c.state.currentUser={id:2,name:'Kitchen',role:'business'};c.state.profile={business_name:'Kitchen'};
  const item={id:7,title:'Biryani',category:'Main Meal',business_name:'Kitchen',original_price:300,rescue_price:150,minimum_price:100,
    daily_status:'Not Available Today',initial_quantity:null,remaining_quantity:null,offer_start_time:'20:00',offer_end_time:'00:00',pricing_readiness:'Ready to train'};
  c.fetch=async(url,options)=>['/api/business/listings','/api/business/analytics'].includes(url)?{ok:true,headers:{get:()=> 'application/json'},json:async()=>
    url.endsWith('listings')?[item]:{summary:{active_listings:0,meals_rescued:100,revenue:10000},sales:[],today:{remaining_portions:15,incoming_orders:3,completed_pickups:2,revenue:600}}}:fetch(url,options);
  await c.showScreen('business');
  const n=id=>ui.document.getElementById(id);
  assert.equal(n('biz-today-portions').textContent,15);assert.equal(n('biz-today-incoming').textContent,3);
  assert.equal(n('biz-today-pickups').textContent,2);assert.equal(n('biz-today-revenue').textContent,'৳600.00');
  assert.match(n('business-next-steps').innerHTML,/1 food item needs/);
  assert.match(n('business-next-steps').innerHTML,/3 incoming orders/);
  assert.match(n('business-listings').innerHTML,/Upload Sales History/);
  assert.match(n('business-listings').innerHTML,/Ready to train/);
  assert.equal(n('biz-tab-listings').style.display,'none');
  n('business-mobile-tab').value='listings';await c.actions.selectBusinessPage({},n('business-mobile-tab'));
  assert.equal(n('biz-tab-overview').style.display,'none');assert.equal(n('biz-tab-listings').style.display,'block');
  assert.equal(n('business-page-title').textContent,'Manage Listings');assert.deepEqual(ui.errors,[]);
});

test('mobile menu, business signup and dismissible feedback are accessible through real delegated controls',async()=>{
  const ui=await setup(),c=ui.context,n=id=>ui.document.getElementById(id);
  await c.showScreen('home');
  c.toggleNavigation();assert.equal(n('nav-menu-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(n('nav-menu').classList.contains('is-open'),true);
  c.installDialogKeyboard();ui.listeners.get('keydown')({key:'Escape',preventDefault(){}});
  assert.equal(n('nav-menu-toggle').getAttribute('aria-expanded'),'false');assert.equal(ui.document.activeElement,n('nav-menu-toggle'));
  await c.actions.openBusinessSignup();assert.equal(c.state.selectedRole,'business');
  assert.equal(n('form-signup').classList.contains('active'),true);assert.equal(ui.document.activeElement,n('signup-name'));
  c.notify('<script>unsafe</script>','error');assert.equal(n('app-notice-message').textContent,'<script>unsafe</script>');
  assert.equal(n('app-notice').hidden,false);assert.equal(n('app-notice').dataset.tone,'error');
  c.actions.dismissNotice();assert.equal(n('app-notice').hidden,true);assert.deepEqual(ui.errors,[]);
});

test('meal cards show accurate discounts and Bangladesh pickup dates, including a midnight deadline',async()=>{
  const ui=await setup(),c=ui.context;
  const card=c.foodCard({id:7,title:'<Biryani>',business_name:'Kitchen',original_price:300,rescue_price:239.99,quantity:2,
    city:'Dhaka',offer_end_time:'00:00',pickup_deadline:'2026-10-03T18:00:00.000Z'});
  assert.match(card,/৳239\.99/);assert.match(card,/20% off/);assert.match(card,/2 portions left/);
  assert.match(card,/4 Oct/);assert.match(card,/12:00 am BST/);assert.match(card,/&lt;Biryani&gt;/);
  assert.equal((card.match(/class="rating-star"/g)||[]).length,5);
  assert.match(c.foodCard({id:8,title:'Meal',original_price:300,rescue_price:148,quantity:1,offer_end_time:'23:00'}),/50% off/);
});

test('loading meal cards are replaced with an actionable error, then recover on retry',async()=>{
  const ui=await setup(),c=ui.context,fetch=c.fetch;await c.ensureView('home');
  let release;
  c.fetch=async(url,options)=>url==='/api/listings'?await new Promise(resolve=>release=()=>resolve({ok:false,status:503,headers:{get:()=> 'application/json'},json:async()=>({message:'Database offline'})})):fetch(url,options);
  const loading=c.refreshMarketplace();
  const grid=ui.document.getElementById('home-featured-grid');
  assert.match(grid.innerHTML,/skeleton-card/);assert.equal(grid.getAttribute('aria-busy'),'true');
  release();await loading;assert.match(grid.innerHTML,/data-click="refreshMarketplace"/);assert.doesNotMatch(grid.innerHTML,/skeleton-card/);
  assert.equal(grid.getAttribute('aria-busy'),'false');
  c.fetch=fetch;await c.refreshMarketplace();assert.match(grid.innerHTML,/Sign in/);assert.doesNotMatch(grid.innerHTML,/could not be loaded/);
});
