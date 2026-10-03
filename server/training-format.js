// A shared, versioned interchange format. No model or pricing policy is run here.
const COLUMNS = ['schema_version','item_reference','offer_date','title','category',
  'original_unit_price','rescue_unit_price','offer_start_time','offer_end_time',
  'initial_quantity','collected_quantity','cancelled_quantity','rejected_quantity',
  'expired_quantity','remaining_quantity','revenue','data_source','snapshot_quality',
  'price_changed','quantity_changed','item_changed'];
const TEXT_COLUMNS = new Set(['item_reference','title','category']);
const unsafeCell = value => /^[\s]*[=+@-]/.test(value) || value.startsWith("'");
function writeCsv(rows, columns=COLUMNS) {
  const encode = value => {
    let text = value instanceof Date ? value.toISOString() : String(value ?? '');
    if (unsafeCell(text)) text="'"+text;
    return /[",\r\n]/.test(text) ? '"'+text.replace(/"/g,'""')+'"' : text;
  };
  return columns.join(',')+'\r\n'+rows.map(row=>columns.map(key=>encode(row[key])).join(',')).join('\r\n')+'\r\n';
}
function parseCsv(text) {
  if (typeof text!=='string' || Buffer.byteLength(text,'utf8')>1024*1024) throw new Error('Choose a UTF-8 CSV file of at most 1 MB.');
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  const endField=()=>{row.push(field);field='';closed=false;};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(quoted) {
      if(char==='"') { if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;} }
      else field+=char;
    } else if(char===',') endField();
    else if(char==='\r'||char==='\n') {
      if(char==='\r'&&text[i+1]==='\n')i++;
      endField();rows.push(row);row=[];
      if(rows.length>5001)throw new Error('Import at most 5,000 rows at a time.');
    } else if(char==='"'&&!field&&!closed) quoted=true;
    else { if(closed||char==='"')throw new Error('Malformed CSV quoting.');field+=char; }
  }
  if(quoted)throw new Error('Unclosed CSV quote.');
  if(field||row.length||closed){endField();rows.push(row);}
  while(rows.length&&rows.at(-1).every(value=>value===''))rows.pop();
  if(!rows.length||rows[0].join(',')!==COLUMNS.join(','))throw new Error('CSV headers must match the downloaded version 1 template, in order.');
  if(rows.length>5001)throw new Error('Import at most 5,000 rows at a time.');
  return rows.slice(1).map((values,index)=>{
    if(values.length!==COLUMNS.length)throw new Error('CSV row '+(index+2)+' has the wrong number of columns.');
    return Object.fromEntries(COLUMNS.map((key,column)=>{
      let value=values[column];
      // Reverse only this writer's spreadsheet-safe text escaping.
      if(TEXT_COLUMNS.has(key)&&value.startsWith("'")&&unsafeCell(value.slice(1)))value=value.slice(1);
      return [key,value];
    }));
  });
}
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
function offerEnd(row) {
  const next=row.offer_end_time<=row.offer_start_time?86400000:0;
  return Date.parse(row.offer_date+'T'+row.offer_end_time+':00+06:00')+next;
}
function validateRows(input,{now=Date.now(),importing=true}={}) {
  const rows=[],errors=[],seen=new Set();
  for(let index=0;index<input.length;index++) {
    const row={...input[index]},issues=[];
    const fail=message=>issues.push(message);
    if(String(row.schema_version)!=='1')fail('Unsupported schema version.');
    row.schema_version=1;
    for(const key of TEXT_COLUMNS) {
      if(typeof row[key]!=='string'||!row[key].trim()||row[key].length>(key==='item_reference'?100:255)||/[\x00-\x08\x0B-\x1F\x7F]/.test(row[key]))fail('Invalid '+key+'.');
    }
    if(importing&&String(row.item_reference).startsWith('plateup:'))fail('plateup: references are reserved for platform exports.');
    if(!validDate(row.offer_date))fail('Invalid offer date.');
    for(const key of ['offer_start_time','offer_end_time'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[key]))fail('Invalid '+key+'.');
    for(const key of ['original_unit_price','rescue_unit_price','revenue']) {
      if(!/^\d+(\.\d{1,2})?$/.test(String(row[key]))||Number(row[key])>99999999.99)fail('Invalid '+key+'; use non-negative amounts with up to two decimals.');
      row[key]=Number(row[key]);
    }
    for(const key of ['initial_quantity','collected_quantity','cancelled_quantity','rejected_quantity','expired_quantity','remaining_quantity']) {
      if(!/^\d+$/.test(String(row[key]))||!Number.isSafeInteger(Number(row[key]))||Number(row[key])>1000000)fail('Invalid '+key+'.');
      row[key]=Number(row[key]);
    }
    for(const key of ['price_changed','quantity_changed','item_changed']) {
      if(!['true','false',true,false].includes(row[key]))fail('Invalid '+key+'; use true or false.');
      row[key]=row[key]===true||row[key]==='true';
    }
    if(!['real','synthetic'].includes(row.data_source))fail('data_source must be real or synthetic.');
    const qualities=importing?['self_reported','synthetic']:['self_reported','synthetic','captured','legacy_estimated'];
    if(!qualities.includes(row.snapshot_quality))fail('Invalid snapshot_quality.');
    if(row.data_source==='synthetic'&&row.snapshot_quality!=='synthetic'||row.data_source==='real'&&row.snapshot_quality==='synthetic')fail('Source and snapshot quality disagree.');
    if(row.rescue_unit_price>row.original_unit_price)fail('Rescue price exceeds original price.');
    if(row.collected_quantity+row.remaining_quantity!==row.initial_quantity)fail('Collected plus remaining must equal the final offered quantity.');
    if(!row.price_changed&&Math.round(row.revenue*100)!==row.collected_quantity*Math.round(row.rescue_unit_price*100))fail('Revenue differs from collected portions times rescue unit price.');
    if(Math.round(row.revenue*100)>row.collected_quantity*Math.round(row.original_unit_price*100))fail('Revenue exceeds original-price sales.');
    if(offerEnd(row)>now)fail('Only ended offers can be imported.');
    const key=row.data_source+'|'+row.item_reference+'|'+row.offer_date;
    if(seen.has(key))fail('Duplicate item/date/source in this file.');seen.add(key);
    if(issues.length)errors.push({row:index+2,issues});
    rows.push(row);
  }
  if(!input.length)errors.push({row:1,issues:['The file has no data rows.']});
  return {rows,errors};
}
function eligibility(row,now=Date.now()) {
  const issues=[];
  if(row.snapshot_quality==='legacy_estimated')issues.push('Historical offer details were reconstructed; exact history is unavailable.');
  if(offerEnd(row)>now)issues.push('Offer has not ended.');
  if(Number(row.pending_quantity||0)>0)issues.push('Reservations remain unresolved.');
  if(Number(row.collected_quantity)+Number(row.remaining_quantity)!==Number(row.initial_quantity))issues.push('Inventory does not reconcile.');
  if(row.sales_mismatches>0)issues.push('Completed orders and sales records disagree.');
  if(row.price_changed)issues.push('Multiple prices: use the event history for interval pricing analysis.');
  if(row.quantity_changed)issues.push('Quantity changed: use inventory events to reconstruct exposure.');
  if(row.item_changed)issues.push('Offer details changed during the recorded window.');
  return {finalized:offerEnd(row)<=now&&!Number(row.pending_quantity||0),training_eligible:issues.length===0,quality_issues:issues};
}
function generateSynthetic({seed=42,days=180,items=5,start='2025-01-01'}={}) {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isInteger(days)||days<1||days>366||!Number.isInteger(items)||items<1||items>10||!validDate(start))throw new Error('Use a seed from 0 to 4294967295, 1–366 days, 1–10 items, and a valid start date.');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const categories=['Main Meal','Bakery','Cafe','Groceries','Produce'];
  const rows=[];
  for(let day=0;day<days;day++)for(let item=0;item<items;item++) {
    const date=new Date(Date.parse(start+'T00:00:00Z')+day*86400000),weekday=date.getUTCDay();
    const original=200+item*50,price=Math.round(original*(0.3+0.4*random()));
    const quantity=5+Math.floor(random()*36);
    // Assumed discount, weekday and item effects plus substantial unexplained variation.
    const demand=random()<0.06?0:Math.max(0,Math.round((10+item*3)*(1-price/original)*(weekday===5||weekday===6?1.3:1)*(0.3+random()*2.4)));
    const reserved=Math.min(quantity,demand),missed=Math.floor(reserved*random()*0.2),collected=reserved-missed;
    rows.push({schema_version:1,item_reference:'sample-'+seed+'-'+(item+1),offer_date:date.toISOString().slice(0,10),
      title:'Synthetic meal '+(item+1),category:categories[item%5],original_unit_price:original,rescue_unit_price:price,
      offer_start_time:'20:00',offer_end_time:item%2?'01:00':'23:00',initial_quantity:quantity,collected_quantity:collected,
      cancelled_quantity:Math.floor(random()*3),rejected_quantity:random()<0.03?1:0,expired_quantity:missed,
      remaining_quantity:quantity-collected,revenue:collected*price,data_source:'synthetic',snapshot_quality:'synthetic',
      price_changed:false,quantity_changed:false,item_changed:false});
  }
  return rows;
}
module.exports={COLUMNS,writeCsv,parseCsv,validateRows,validDate,offerEnd,eligibility,generateSynthetic};
