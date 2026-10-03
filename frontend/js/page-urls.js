// Application-owned URLs. Never turn a URL into an arbitrary partial/import path.
export const screenPaths = Object.freeze({home:'/',login:'/login',customer:'/browse-food',
  restaurants:'/restaurants','my-orders':'/orders',favorites:'/favorites',profile:'/profile',
  recovery:'/forgot-password','reset-password':'/reset-password',business:'/business'});
export const businessTabs = Object.freeze(['overview','listings','orders','analytics','reviews','profile','training']);

export function readPageUrl() {
  const path=(location.hash?.startsWith('#/')?location.hash.slice(1).split('?')[0]:location.pathname||'/').replace(/\/+$/,'')||'/';
  const restaurant=/^\/restaurants\/([1-9]\d*)$/.exec(path);
  if(restaurant&&Number.isSafeInteger(Number(restaurant[1])))return {screen:'restaurant',restaurantId:Number(restaurant[1])};
  const business=/^\/business\/([a-z-]+)$/.exec(path);
  if(business&&businessTabs.includes(business[1]))return {screen:'business',tab:business[1]};
  const screen=Object.keys(screenPaths).find(key=>screenPaths[key]===path);
  return {screen:screen||'home'};
}

export function pagePath(screen,{tab='overview',restaurantId}={}) {
  if(screen==='business'&&businessTabs.includes(tab)&&tab!=='overview')return '/business/'+tab;
  if(screen==='restaurant'&&Number.isSafeInteger(restaurantId)&&restaurantId>0)return '/restaurants/'+restaurantId;
  return screenPaths[screen]||'/';
}

export function writePageUrl(screen,options={},mode='push') {
  if(mode==='none'||typeof history==='undefined')return;
  const path=pagePath(screen,options);
  // Live Server has no Express route fallback; keep its existing HTML entry URL.
  const url=location.port==='5500'?(location.pathname||'/frontend/index.html')+'#'+path:path;
  const current=(location.pathname||'/')+(location.search||'')+(location.hash||'');
  if(current===url&&mode!=='replace')return;
  const method=mode==='replace'?'replaceState':'pushState';
  history[method]?.({plateup:true},'',url);
}
