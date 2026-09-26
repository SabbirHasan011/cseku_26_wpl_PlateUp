const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual UI functions without starting the app's network/timer bootstrap.
function frontend(storage=new Map()) {
  const nodes = new Map(), events = new Map();
  const document = { activeElement:null,body:{ classList:classes() },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id,{ value:'',textContent:'',innerHTML:'',disabled:false,
        hidden:false,isConnected:true,classList:classes(),setAttribute() {},
        reset() {},focus() { document.activeElement=this; },querySelectorAll() { return []; } });
      return nodes.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(name,handler) { events.set(name,handler); }
  };
  function classes() {
    const set = new Set();
    return { add:value=>set.add(value),remove:value=>set.delete(value),contains:value=>set.has(value) };
  }
  const item = { id:17,title:'Chicken biryani',category:'Main Meal',business_name:'Test Kitchen',
    city:'Dhaka',pickup_address:'12 Test Road',description:'With egg and salad',quantity:5,
    original_price:300,rescue_price:150,offer_start_time:'20:00:00',offer_end_time:'00:00:00',
    average_rating:'3.5',review_count:2 };
  const calls = [], alerts = [];
  const categories=[{ id:1,name:'Bakery' },{ id:2,name:'Main Meal' }];
  const context = vm.createContext({ document,location:{ protocol:'http:',port:'5000' },
    localStorage:{ getItem(key) { return storage.get(key)||null; },setItem(key,value) {storage.set(key,value);},removeItem(key) {storage.delete(key);} },
    FormData,URL,console,alert:message=>alerts.push(message),setTimeout:()=>1,clearTimeout() {},
    fetch:async (url,options)=>{
      calls.push({ url,options });
      let result={ listing:item };
      if (url==='/api/favorites') result={saved:[],restaurants:[],listings:[]};
      if (url==='/api/categories') {
        if (options.method==='POST') {
          const category={ id:categories.length+1,name:JSON.parse(options.body).name };
          categories.push(category); result={ category };
        } else result=categories.map(row=>({ ...row }));
      }
      const restaurant={ id:42,business_name:'Test Kitchen',city:'Dhaka',description:'Local kitchen',address:'12 Test Road',review_count:0 };
      if (url==='/api/restaurants') result=[restaurant];
      if (url==='/api/restaurants/42') result={ restaurant,listings:[{ ...item,business_id:42 }] };
      if (url==='/api/cart/quote') {
        const requested=JSON.parse(options.body).items;
        const items=requested.map(row=>({ ...row,unit_price:item.rescue_price,
          available_quantity:item.quantity,total_price:row.quantity*item.rescue_price,
          error:row.quantity>item.quantity?'Not enough portions.':null }));
        result={ items,valid:items.every(row=>!row.error),total_price:items.reduce((sum,row)=>sum+row.total_price,0) };
      }
      if (url==='/api/orders') result=options.method==='POST'?{ orders:[] }:[];
      return { ok:true,headers:{ get:()=> 'application/json' },json:async ()=>result };
    }
  });
  const source = fs.readFileSync(path.join(__dirname,'../assets/js/app.js'),'utf8');
  const bootstrap = source.lastIndexOf('\nrenderTopNav();\nloadInitialData();');
  assert.ok(bootstrap>0);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/experience.js'),'utf8'),context);
  vm.runInContext(source.slice(0,bootstrap),context);
  vm.runInContext(`currentUser={id:1,name:'Customer',role:'customer'};
    profile={customer_city:'Dhaka'}; listings=[${JSON.stringify(item)}];`,context);
  return { context,document,events,calls,alerts,item,storage,run:code=>vm.runInContext(code,context),node:document.getElementById };
}

test('adding selected portions keeps checkout closed until the customer opens the cart',async ()=>{
  const ui=frontend();
  ui.node('open-button').focus();
  await ui.context.openListingDetails(17);
  assert.equal(ui.calls[0].url,'/api/listings/17');
  assert.equal(ui.document.activeElement,ui.node('detail-close'));
  assert.equal(ui.node('listing-detail-modal').classList.contains('active'),true);
  assert.match(ui.node('detail-body').innerHTML,/Ends the next day/);
  ui.context.stepDetailQuantity(1); ui.context.stepDetailQuantity(1);
  assert.equal(ui.node('detail-quantity').value,'3');
  assert.match(ui.node('detail-total').textContent,/450\.00/);
  ui.context.reserveDetail({ preventDefault() {} });
  assert.equal(ui.run('cartItems.length'),3);
  assert.equal(ui.node('listing-detail-modal').classList.contains('active'),false);
  assert.equal(ui.document.activeElement,ui.node('open-button'));
  assert.equal(ui.node('checkout-modal').classList.contains('active'),false);
  assert.equal(ui.node('cart-toast').hidden,false);
  assert.match(ui.node('cart-toast-message').textContent,/3 portions added/);
  assert.equal(ui.calls.length,1,'Adding to cart must not quote or submit an order');
  ui.context.openCheckoutModal();
  await ui.context.refreshCartQuote();
  assert.equal(ui.node('checkout-modal').classList.contains('active'),true);
  assert.equal(ui.document.body.classList.contains('cart-is-open'),true);
  assert.equal(ui.document.activeElement,ui.node('cart-close'));
  assert.equal(ui.node('cart-toast').hidden,true);
  assert.match(ui.node('checkout-summary').innerHTML,/Chicken biryani/);
  assert.match(ui.node('checkout-summary').innerHTML,/Test Kitchen/);
  assert.match(ui.node('cart-grand-total').textContent,/450\.00/);
  assert.match(ui.node('checkout-summary').innerHTML,/450\.00/);
  ui.events.get('keydown')({ key:'Escape',preventDefault() {} });
  assert.equal(ui.node('checkout-modal').classList.contains('active'),false);
  assert.equal(ui.document.body.classList.contains('cart-is-open'),false);
  assert.equal(ui.document.activeElement,ui.node('open-button'));

  await ui.context.openListingDetails(17);
  assert.equal(ui.node('detail-quantity').max,'2');
  for (const value of ['0','1.5','3','']) {
    ui.node('detail-quantity').value=value; ui.context.updateDetailQuantity();
    assert.equal(ui.node('detail-reserve').disabled,true);
    ui.context.reserveDetail({ preventDefault() {} });
    assert.equal(ui.run('cartItems.length'),3);
  }
  ui.node('detail-quantity').value='2'; ui.context.updateDetailQuantity();
  assert.equal(ui.node('detail-reserve').disabled,false);
  assert.equal(ui.node('detail-plus').disabled,true);
  ui.context.reserveDetail({ preventDefault() {} });
  assert.equal(ui.run('cartItems.length'),5);
  assert.equal(ui.node('checkout-modal').classList.contains('active'),false);
  await ui.context.openListingDetails(17);
  assert.equal(ui.node('detail-reserve').disabled,true);
  assert.equal(ui.node('detail-quantity').disabled,true);
  ui.events.get('keydown')({ key:'Escape',preventDefault() {} });
  assert.equal(ui.node('listing-detail-modal').classList.contains('active'),false);
  assert.equal(ui.document.body.classList.contains('meal-dialog-open'),false);
});

test('every rating shows five stars with fractional fill and an honest empty state',()=>{
  const ui=frontend();
  const rating=ui.context.itemRating(ui.item);
  assert.equal((rating.match(/class="rating-star"/g)||[]).length,5);
  assert.match(rating,/width:50%/);
  assert.match(rating,/3.5 out of 5 from 2 reviews/);
  const empty=ui.context.itemRating({ average_rating:null,review_count:0 });
  assert.equal((empty.match(/class="rating-star"/g)||[]).length,5);
  assert.equal((empty.match(/width:0%/g)||[]).length,5);
  assert.match(empty,/No reviews yet/);
  ui.context.renderListings();
  assert.match(ui.node('listing-grid').innerHTML,/3.5/);
  ui.run('listings=[]; profile.customer_city=null');
  ui.context.renderListings();
  assert.match(ui.node('listing-grid').innerHTML,/Set my city/);
  assert.equal(ui.node('loc-search').readOnly,true);
});

test('food editor loads saved categories, creates and selects one, and rejects unsaved categories',async ()=>{
  const ui=frontend();
  await ui.context.openNewListingModal();
  assert.match(ui.node('m-category').innerHTML,/<option value="Bakery">Bakery<\/option>/);
  assert.equal(ui.node('m-category').value,'');
  assert.equal(ui.node('m-category').disabled,false);
  ui.context.toggleCategoryEditor(true);
  ui.node('new-category-name').value='Desserts';
  await ui.context.saveFoodCategory();
  assert.equal(ui.node('m-category').value,'Desserts');
  assert.equal(ui.node('category-editor').hidden,true);
  ui.context.closeModal('new-listing-modal');
  await ui.context.openNewListingModal();
  assert.match(ui.node('m-category').innerHTML,/Desserts/);
  ui.node('m-category').value='Unsaved free text';
  await ui.context.submitNewListing();
  assert.match(ui.node('listing-feedback').textContent,/Choose a category/);
  assert.equal(ui.calls.some(call=>call.url==='/api/listings'),false);
  ui.run('businessListings=[{id:21,title:"Existing item",category:"Main Meal",original_price:150,rescue_price:99.5,offer_start_time:"22:15:00",offer_end_time:"01:00:00"}]');
  await ui.context.openEditListingModal(21);
  assert.equal(ui.node('m-category').value,'Main Meal');
  assert.equal(ui.node('m-rescue-price').value,99.5);
  assert.equal(ui.node('m-start-display').textContent,'10:15 PM');
  assert.equal(ui.node('m-end-display').textContent,'1:00 AM');
  assert.match(ui.node('offer-window-note').textContent,/next day/);
});

test('time picker advances hour and minute then saves and closes on AM/PM, including midnight and noon',()=>{
  const ui=frontend();
  ui.node('m-start').value='20:00'; ui.node('m-end').value='00:00';
  ui.context.openOfferTimePicker('m-start');
  ui.context.selectOfferTimePart('hour','12');
  assert.equal(ui.run('offerTimeDraft.stage'),'minute');
  assert.equal(ui.node('offer-time-picker').hidden,false);
  ui.context.selectOfferTimePart('minute','05');
  assert.equal(ui.run('offerTimeDraft.stage'),'period');
  assert.equal(ui.node('m-start').value,'20:00','Draft changes must not overwrite the saved time');
  ui.context.selectOfferTimePart('period','AM');
  assert.equal(ui.node('m-start').value,'00:05');
  assert.equal(ui.node('offer-time-picker').hidden,true);
  assert.equal(ui.document.activeElement,ui.node('m-start-trigger'));
  ui.context.openOfferTimePicker('m-end');
  ui.context.selectOfferTimePart('hour','12');
  ui.context.selectOfferTimePart('minute','00');
  ui.context.selectOfferTimePart('period','PM');
  assert.equal(ui.node('m-end').value,'12:00');
  assert.equal(ui.node('m-end-display').textContent,'12:00 PM');
  ui.context.openOfferTimePicker('m-end');
  ui.context.selectOfferTimePart('hour','9');
  ui.events.get('keydown')({key:'Escape',preventDefault(){}});
  assert.equal(ui.node('m-end').value,'12:00');
  assert.equal(ui.node('offer-time-picker').hidden,true);
  ui.node('m-start').value='20:00'; ui.node('m-end').value='00:00';
  ui.context.updateOfferTimeLabels();
  assert.match(ui.node('offer-window-note').textContent,/next day/);
  ui.node('m-end').value='20:00'; ui.context.updateOfferTimeLabels();
  assert.match(ui.node('offer-window-note').textContent,/24 hours/);
});

test('restaurant directory, menu search and meal details connect to the cart without a loaded feed',async ()=>{
  const ui=frontend();
  await ui.context.loadRestaurants();
  assert.match(ui.node('restaurant-grid').innerHTML,/Test Kitchen/);
  assert.match(ui.node('restaurant-grid').innerHTML,/openRestaurant\(42\)/);
  ui.node('restaurant-search').value='not a restaurant'; ui.context.renderRestaurants();
  assert.match(ui.node('restaurant-grid').innerHTML,/No restaurants match/);
  ui.node('restaurant-search').value='dhaka'; ui.context.renderRestaurants();
  assert.match(ui.node('restaurant-grid').innerHTML,/Test Kitchen/);
  ui.context.openRestaurant(42);
  await ui.context.loadRestaurant();
  assert.equal(ui.run('activeScreen'),'restaurant');
  assert.match(ui.node('restaurant-profile').innerHTML,/Test Kitchen/);
  assert.match(ui.node('restaurant-menu-grid').innerHTML,/Chicken biryani/);
  ui.node('restaurant-food-search').value='bakery'; ui.context.renderRestaurantMenu();
  assert.match(ui.node('restaurant-menu-grid').innerHTML,/No meals match/);
  ui.node('restaurant-food-search').value='egg'; ui.context.renderRestaurantMenu();
  assert.match(ui.node('restaurant-menu-grid').innerHTML,/openListingDetails\(17\)/);
  ui.run('listings=[]');
  await ui.context.openListingDetails(17);
  ui.context.stepDetailQuantity(1);
  ui.context.reserveDetail({ preventDefault() {} });
  assert.equal(ui.run('cartItems.length'),2);
  assert.equal(ui.node('checkout-modal').classList.contains('active'),false);
  await ui.context.refreshCartQuote();
  assert.equal(ui.node('cart-confirm').disabled,false);
  assert.match(ui.node('checkout-summary').innerHTML,/Chicken biryani/);
  ui.context.showScreen('restaurants');
  assert.equal(ui.run('activeScreen'),'restaurants');
});

test('restaurant request failures remove stale meals and menus explain city restrictions',async ()=>{
  const ui=frontend();
  ui.context.openRestaurant(42); await ui.context.loadRestaurant();
  ui.run("restaurantListings=[]; selectedRestaurant.city='Khulna'");
  ui.context.renderRestaurantMenu();
  assert.match(ui.node('restaurant-menu-grid').innerHTML,/another city/);
  ui.context.fetch=async()=>{ throw new Error('Offline'); };
  await ui.context.loadRestaurant();
  assert.equal(ui.node('restaurant-menu-grid').innerHTML,'');
  assert.match(ui.node('restaurant-menu-status').textContent,/Could not load restaurant/);
  await ui.context.loadRestaurants();
  assert.equal(ui.node('restaurant-grid').innerHTML,'');
  assert.match(ui.node('restaurant-directory-status').textContent,/Could not load restaurants/);
});

test('cart quantities, current prices, removal and clearing stay connected to checkout',async ()=>{
  const ui=frontend();
  ui.context.addToCart(17,2);
  await ui.context.refreshCartQuote();
  assert.equal(ui.node('cart-confirm').disabled,false);
  assert.match(ui.node('checkout-summary').innerHTML,/300\.00/);
  ui.context.stepCartQuantity(17,1);
  await ui.context.refreshCartQuote();
  assert.equal(ui.run('cartItems.length'),3);
  assert.match(ui.node('cart-grand-total').textContent,/450\.00/);
  ui.context.stepCartQuantity(17,-1);
  await ui.context.refreshCartQuote();
  assert.equal(ui.run('cartItems.length'),2);
  ui.context.changeCartQuantity(17,4);
  await ui.context.refreshCartQuote();
  assert.equal(ui.run('cartItems.length'),4);
  assert.match(ui.node('checkout-summary').innerHTML,/600\.00/);
  ui.context.changeCartQuantity(17,6);
  await ui.context.refreshCartQuote();
  assert.equal(ui.node('cart-confirm').disabled,true);
  ui.context.changeCartQuantity(17,2);
  ui.item.rescue_price=175;
  await ui.context.refreshCartQuote();
  assert.match(ui.node('cart-feedback').textContent,/Prices have changed/);
  assert.match(ui.node('checkout-summary').innerHTML,/350\.00/);
  ui.run('loadInitialData=async()=>{}; renderProfile=()=>{}; refreshNotifications=async()=>{};');
  await ui.context.confirmOrder();
  const orderRequest=ui.calls.find(call=>call.url==='/api/orders' && call.options.method==='POST');
  assert.deepEqual(JSON.parse(orderRequest.options.body).items,[{ listing_id:17,quantity:2,unit_price:175 }]);
  assert.equal(ui.run('cartItems.length'),0);
  ui.context.addToCart(17,1);
  ui.context.removeCartItem(17);
  assert.equal(ui.run('cartItems.length'),0);
  assert.equal(ui.node('cart-confirm').disabled,true);
  ui.context.addToCart(17,2); ui.context.clearCart();
  assert.equal(ui.run('cartItems.length'),0);
  assert.match(ui.node('checkout-summary').innerHTML,/Your cart is empty/);
  assert.equal(ui.node('cart-pickup-note').hidden,true);
  assert.match(ui.node('cart-grand-total').textContent,/0\.00/);
});

test('city selection resolves aliases and rejects values outside the shared catalog',()=>{
  const ui=frontend();
  ui.run("cities=[{id:1,name:'Chattogram',aliases:['chittagong']}]");
  ui.node('profile-edit-city').value=' CHITTAGONG ';
  assert.equal(ui.context.selectedCityId('profile-edit-city'),1);
  assert.equal(ui.node('profile-edit-city').value,'Chattogram');
  ui.node('profile-edit-city').value='Unknown city';
  assert.throws(()=>ui.context.selectedCityId('profile-edit-city'),/Choose a city/);
  ui.node('profile-edit-city').value='';
  assert.equal(ui.context.selectedCityId('profile-edit-city'),null);
});

test('missing routes on an old backend explain the restart needed instead of a connection failure',async ()=>{
  const ui=frontend();
  ui.context.fetch=async ()=>({ status:404,ok:false,headers:{ get:()=> 'text/html' } });
  await assert.rejects(ui.context.requestJson('/cities'),/missing \/cities.*older backend.*Ctrl\+C/);
  ui.context.fetch=async ()=>({ status:200,ok:true,headers:{ get:()=> 'text/html' } });
  await assert.rejects(ui.context.requestJson('/cities'),/received a web page \(HTTP 200\)/);
});

test('pickup form sends the entered code and business orders do not offer unchecked completion',async ()=>{
  const ui=frontend();
  ui.run("businessOrders=[{id:31,status:'ready',listing_title:'Test meal',quantity:2,total_price:300}]; loadBusiness=async()=>{}; refreshNotifications=async()=>{};");
  ui.context.renderBusinessOrders();
  assert.match(ui.node('business-orders').innerHTML,/Verify pickup/);
  assert.doesNotMatch(ui.node('business-orders').innerHTML,/Mark completed/);
  ui.context.openPickupVerification(31);
  ui.node('pickup-code-input').value='31-ABCDEF';
  await ui.context.verifyPickup({ preventDefault() {} });
  const request=ui.calls.find(call=>call.url==='/api/orders/31');
  assert.deepEqual(JSON.parse(request.options.body),{status:'completed',pickup_code:'31-ABCDEF'});
  assert.equal(ui.node('pickup-modal').classList.contains('active'),false);
});

test('notification inbox displays unread counts and persists read actions',async ()=>{
  const ui=frontend();
  ui.run("token='customer-session'");
  const notes=[{ id:9,order_id:31,message:'Meal <ready>',event:'ready',created_at:'2026-09-25T12:00:00Z',read_at:null }];
  const actions=[];
  ui.context.fetch=async (url,options)=>{
    if (options.method==='PATCH') { actions.push({ url,body:options.body }); notes[0].read_at='2026-09-25T12:01:00Z'; }
    return { ok:true,headers:{ get:()=> 'application/json' },json:async ()=>({ notifications:notes,unread_count:notes.filter(note=>!note.read_at).length }) };
  };
  await ui.context.openNotifications();
  assert.equal(ui.node('notification-count').textContent,1);
  assert.match(ui.node('notifications-list').innerHTML,/Meal &lt;ready&gt;/);
  await ui.context.markNotificationRead(9);
  assert.equal(ui.node('notification-count').textContent,0);
  assert.equal(actions[0].url,'/api/notifications/9/read');
  notes[0].read_at=null;
  await ui.context.refreshNotifications(); await ui.context.markNotificationsRead();
  assert.equal(JSON.parse(actions[1].body).through_id,9);
  assert.equal(ui.node('notification-count').textContent,0);
});

test('saved carts survive reload, validate prices and stock, and stay isolated by account and city',async()=>{
  const storage=new Map(), first=frontend(storage);
  first.run('profile.customer_city_id=1');
  first.context.addToCart(17,2);
  assert.equal(JSON.parse(storage.get('plateup_cart_1')).items[0].quantity,2);
  const reload=frontend(storage);reload.run('profile.customer_city_id=1');
  reload.item.rescue_price=175;
  await reload.context.restoreCart();
  assert.equal(reload.run('cartItems.length'),2);
  assert.equal(reload.run('cartItems[0].price'),175);
  assert.equal(reload.node('cart-confirm').disabled,false);
  assert.match(reload.node('cart-feedback').textContent,/Prices have changed/);
  const unavailable=frontend(storage);unavailable.run('profile.customer_city_id=1');unavailable.item.quantity=0;
  await unavailable.context.restoreCart();
  assert.equal(unavailable.node('cart-confirm').disabled,true);
  assert.match(unavailable.node('cart-feedback').textContent,/unavailable/);
  const other=frontend(storage);other.run('currentUser.id=2; profile.customer_city_id=1');
  await other.context.restoreCart();assert.equal(other.run('cartItems.length'),0);
  const moved=frontend(storage);moved.run('profile.customer_city_id=2');
  await moved.context.restoreCart();assert.equal(moved.run('cartItems.length'),0);
  const corrupt=frontend(new Map([['plateup_cart_1','not-json']]));
  await corrupt.context.restoreCart();assert.equal(corrupt.run('cartItems.length'),0);
});

test('marketplace category buttons come from the saved catalog and escape category text',async()=>{
  const ui=frontend();
  ui.context.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>[{id:1,name:'Desserts <special>'},{id:2,name:'Main Meal'}]});
  await ui.context.loadMarketplaceCategories();
  assert.match(ui.node('marketplace-categories').innerHTML,/Desserts &lt;special&gt;/);
  assert.match(ui.node('marketplace-categories').innerHTML,/data-category=/);
  ui.run("activeCategory='Removed category'");await ui.context.loadMarketplaceCategories();
  assert.equal(ui.run('activeCategory'),'All');
});

test('My Orders shows progress, deadlines, terminal reasons, and only eligible actions',()=>{
  const ui=frontend();
  ui.run(`orders=[{id:1,listing_title:'Bread',business_name:'Bakery',quantity:2,total_price:100,status:'ready',pickup_code:'1-ABCDEF',pickup_deadline:'2026-09-26T18:00:00Z'},
    {id:2,listing_title:'Rice',business_name:'Kitchen',quantity:1,total_price:80,status:'completed'},
    {id:3,listing_title:'Salad',business_name:'Kitchen',quantity:1,total_price:60,status:'rejected',status_reason:'Closed <today>'}]`);
  ui.context.setOrderTab('active');
  assert.match(ui.node('my-orders-list').innerHTML,/order-timeline/);
  assert.match(ui.node('my-orders-list').innerHTML,/1-ABCDEF/);
  assert.match(ui.node('my-orders-list').innerHTML,/Pickup by/);
  assert.doesNotMatch(ui.node('my-orders-list').innerHTML,/Cancel reservation|Review meal/);
  ui.context.setOrderTab('completed');assert.match(ui.node('my-orders-list').innerHTML,/Review meal/);
  ui.context.setOrderTab('history');assert.match(ui.node('my-orders-list').innerHTML,/Closed &lt;today&gt;/);
  assert.doesNotMatch(ui.node('my-orders-list').innerHTML,/pickup-code|Cancel reservation/);
});

test('favorites distinguish available meals from saved unavailable items',()=>{
  const ui=frontend();
  ui.run(`favorites={saved:[{listing_id:17,title:'Meal'},{business_id:42,title:'Kitchen'}],restaurants:[{id:42,business_name:'Kitchen',city:'Dhaka'}],listings:[]}`);
  ui.context.renderFavorites();
  assert.match(ui.node('favorite-restaurants').innerHTML,/openRestaurant\(42\)/);
  assert.match(ui.node('unavailable-favorites').innerHTML,/Currently unavailable/);
  assert.doesNotMatch(ui.node('unavailable-favorites').innerHTML,/openListingDetails/);
  assert.match(ui.context.favoriteButton('listing',17),/aria-pressed="true"/);
});

test('reset links are removed from the address and password forms send the expected secure requests',async()=>{
  const ui=frontend();
  const resetToken='a'.repeat(64), replaced=[];
  Object.assign(ui.context.location,{hash:'#reset='+resetToken,pathname:'/',search:''});
  ui.context.history={replaceState:(...args)=>replaced.push(args)};
  assert.equal(ui.context.captureResetLink(),true);
  assert.equal(replaced[0][2],'/');assert.equal(ui.run('activeScreen'),'reset-password');
  ui.node('reset-new').value='NewPassword123!';ui.node('reset-confirm').value='different';
  await ui.context.resetPassword({preventDefault(){}});
  assert.match(ui.node('reset-feedback').textContent,/do not match/);
  ui.context.fetch=async(url,options)=>{
    ui.calls.push({url,options});return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({message:'Password reset.'})};
  };
  ui.run('handleLogout=()=>{}; refreshMarketplace=async()=>{};');
  ui.node('reset-confirm').value='NewPassword123!';
  await ui.context.resetPassword({preventDefault(){}});
  assert.deepEqual(JSON.parse(ui.calls.find(call=>call.url==='/api/auth/reset-password').options.body),{token:resetToken,new_password:'NewPassword123!'});
  assert.equal(ui.run('resetPasswordToken'),null);
  assert.equal(ui.run('activeScreen'),'login');
  ui.node('recovery-email').value='customer@example.test';
  await ui.context.requestPasswordReset({preventDefault(){}});
  assert.deepEqual(JSON.parse(ui.calls.find(call=>call.url==='/api/auth/forgot-password').options.body),{email:'customer@example.test'});
});
