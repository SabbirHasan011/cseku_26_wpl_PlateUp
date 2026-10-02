const express=require('express');
const pool=require('./db');
const {expireOrders}=require('./order-lifecycle');
const {writeCsv,parseCsv,validateRows,validDate,eligibility,generateSynthetic}=require('./training-format');

const platformSql=`SELECT 1 AS schema_version,'plateup:'||l.id AS item_reference,a.offer_date::text,
  s.title,s.category,s.original_unit_price,s.rescue_unit_price,
  to_char(s.offer_start_time,'HH24:MI') AS offer_start_time,to_char(s.offer_end_time,'HH24:MI') AS offer_end_time,
  a.initial_quantity,COALESCE(o.collected,0)::int AS collected_quantity,
  COALESCE(o.cancelled,0)::int AS cancelled_quantity,COALESCE(o.rejected,0)::int AS rejected_quantity,
  COALESCE(o.expired,0)::int AS expired_quantity,a.remaining_quantity,
  COALESCE(o.revenue,0)::numeric AS revenue,'real' AS data_source,s.quality AS snapshot_quality,
  COALESCE(e.price_changed,FALSE) AS price_changed,COALESCE(e.quantity_changed,FALSE) AS quantity_changed,
  COALESCE(e.item_changed,FALSE) AS item_changed,COALESCE(o.pending,0)::int AS pending_quantity,
  COALESCE(o.mismatches,0)::int AS sales_mismatches,s.first_quantity,s.captured_at,a.id AS daily_availability_id
  FROM daily_availability a JOIN listings l ON l.id=a.listing_id
  JOIN offer_snapshots s ON s.daily_availability_id=a.id
  LEFT JOIN LATERAL (SELECT
    SUM(o.quantity) FILTER (WHERE o.status='completed') AS collected,
    SUM(o.quantity) FILTER (WHERE o.status='cancelled') AS cancelled,
    SUM(o.quantity) FILTER (WHERE o.status='rejected') AS rejected,
    SUM(o.quantity) FILTER (WHERE o.status='expired') AS expired,
    SUM(o.quantity) FILTER (WHERE o.status IN ('pending','confirmed','ready')) AS pending,
    SUM(o.total_price) FILTER (WHERE o.status='completed') AS revenue,
    COUNT(*) FILTER (WHERE (o.status='completed' AND (sales.id IS NULL OR sales.quantity_sold<>o.quantity OR sales.price<>o.total_price
      OR sales.business_id<>l.business_id OR sales.listing_id<>l.id)) OR (o.status<>'completed' AND sales.id IS NOT NULL)) AS mismatches
    FROM orders o LEFT JOIN sales_data sales ON sales.order_id=o.id WHERE o.daily_availability_id=a.id) o ON TRUE
  LEFT JOIN LATERAL (SELECT BOOL_OR(event_type='price_changed') AS price_changed,
    BOOL_OR(event_type='quantity_changed') AS quantity_changed,BOOL_OR(event_type='item_changed') AS item_changed
    FROM offer_events WHERE daily_availability_id=a.id) e ON TRUE
  WHERE l.business_id=$1 AND a.offer_date BETWEEN $2::date AND $3::date ORDER BY a.offer_date,l.id`;

function range(query) {
  const from=query.from||'2000-01-01',to=query.to||'2100-12-31';
  if(!validDate(from)||!validDate(to)||from>to)throw Object.assign(new Error('Choose a valid date range.'),{status:400});
  return {from,to};
}
async function loadDataset(user,query={}) {
  const {from,to}=range(query),source=query.source||'platform';
  if(!['platform','restaurant','synthetic'].includes(source))throw Object.assign(new Error('Choose platform, restaurant, or synthetic data.'),{status:400});
  // Finalize overdue outcomes even when nobody has visited the orders screen.
  await expireOrders(user);
  const result=source==='platform'?await pool.query(platformSql,[user.userId,from,to]):
    await pool.query(`SELECT record FROM training_records WHERE business_id=$1 AND data_source=$2
      AND offer_date BETWEEN $3::date AND $4::date ORDER BY offer_date,item_reference`,[user.userId,source==='synthetic'?'synthetic':'real',from,to]);
  const rows=result.rows.map(value=>{
    const row=source==='platform'?value:value.record;
    const checks=eligibility(row);
    if(source==='platform') {
      const issues=validateRows([row],{importing:false}).errors.flatMap(error=>error.issues).filter(issue=>issue!=='Only ended offers can be imported.');
      checks.quality_issues=[...new Set([...checks.quality_issues,...issues])];
      checks.training_eligible=checks.quality_issues.length===0;
    }
    return {...row,...checks};
  });
  const diagnostics=source==='platform'?(await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM orders o JOIN listings l ON l.id=o.listing_id WHERE l.business_id=$1 AND o.daily_availability_id IS NULL) AS unlinked_orders,
    (SELECT COUNT(*)::int FROM daily_availability a JOIN listings l ON l.id=a.listing_id
      LEFT JOIN offer_snapshots s ON s.daily_availability_id=a.id WHERE l.business_id=$1 AND s.daily_availability_id IS NULL) AS missing_snapshots`,[user.userId])).rows[0]:null;
  return {source,from,to,rows,diagnostics,summary:{total:rows.length,eligible:rows.filter(row=>row.training_eligible).length,
    unfinished:rows.filter(row=>!row.finalized).length,flagged:rows.filter(row=>!row.training_eligible).length,
    synthetic:rows.filter(row=>row.data_source==='synthetic').length}};
}
function registerTrainingData(app,{auth,role,wrap}) {
  const guard=[auth,role('business')];
  app.get('/api/business/training-data',...guard,wrap(async(req,res)=>{
    const dataset=await loadDataset(req.user,req.query);
    res.set('Cache-Control','private, no-store');
    if(req.query.format==='csv') {
      res.type('text/csv').attachment('plateup-'+dataset.source+'-training.csv');
      return res.send(writeCsv(dataset.rows.filter(row=>row.training_eligible)));
    }
    const {rows,...meta}=dataset;
    res.json({...meta,rows:rows.slice(0,100),preview_limit:100});
  }));
  app.get('/api/business/training-data/template',...guard,(_,res)=>{
    res.type('text/csv').attachment('plateup-training-template.csv').send(writeCsv([]));
  });
  app.post('/api/business/training-data/import',...guard,express.text({type:'text/csv',limit:'1mb'}),wrap(async(req,res)=>{
    let validation;
    try {validation=validateRows(parseCsv(req.body));}
    catch(error){return res.status(400).json({message:error.message});}
    if(validation.errors.length)return res.status(400).json({message:'CSV validation failed. Nothing was imported.',errors:validation.errors.slice(0,50)});
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT user_id FROM businesses WHERE user_id=$1 FOR UPDATE',[req.user.userId]);
      const json=JSON.stringify(validation.rows);
      const duplicate=await db.query(`SELECT r.item_reference,r.offer_date::text,r.data_source FROM training_records r
        JOIN jsonb_to_recordset($2::jsonb) AS incoming(item_reference text,offer_date date,data_source text)
        ON r.item_reference=incoming.item_reference AND r.offer_date=incoming.offer_date AND r.data_source=incoming.data_source
        WHERE r.business_id=$1 LIMIT 50`,[req.user.userId,json]);
      if(duplicate.rows.length){await db.query('ROLLBACK');return res.status(409).json({message:'Some item/date/source records already exist. Nothing was imported.',duplicates:duplicate.rows});}
      if(req.query.dry_run==='true') {
        await db.query('ROLLBACK');
        return res.json({message:'File validated. No records saved.',valid:true,count:validation.rows.length});
      }
      await db.query(`INSERT INTO training_records(business_id,item_reference,offer_date,data_source,record)
        SELECT $1,value->>'item_reference',(value->>'offer_date')::date,value->>'data_source',value
        FROM jsonb_array_elements($2::jsonb)`,[req.user.userId,json]);
      await db.query('COMMIT');
      res.status(201).json({message:'Imported '+validation.rows.length+' isolated dataset records.',count:validation.rows.length});
    } catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }));
  app.post('/api/business/training-data/synthetic',...guard,wrap(async(req,res)=>{
    let rows;
    try {
      rows=generateSynthetic(req.body||{});
      if(validateRows(rows).errors.length)throw new Error('Use a historical range whose offers have all ended.');
    }catch(error){return res.status(400).json({message:error.message});}
    res.set('Cache-Control','private, no-store');
    res.json({csv:writeCsv(rows),count:rows.length,seed:req.body.seed??42,
      message:'Synthetic demonstration data. Download it or validate/import it into the isolated dataset.'});
  }));
  app.get('/api/business/training-data/events',...guard,wrap(async(req,res)=>{
    const {from,to}=range(req.query);
    const result=await pool.query(`SELECT 'plateup:'||l.id AS item_reference,a.offer_date::text,e.id,e.event_type,e.observed_at,
      e.original_unit_price,e.rescue_unit_price,e.initial_quantity,e.remaining_quantity,
      e.order_id,e.order_quantity,e.order_status,e.order_unit_price
      FROM offer_events e JOIN daily_availability a ON a.id=e.daily_availability_id JOIN listings l ON l.id=a.listing_id
      WHERE l.business_id=$1 AND a.offer_date BETWEEN $2::date AND $3::date ORDER BY e.id`,[req.user.userId,from,to]);
    res.set('Cache-Control','private, no-store');
    res.type('text/csv').attachment('plateup-offer-events.csv').send(writeCsv(result.rows,
      ['item_reference','offer_date','id','event_type','observed_at','original_unit_price','rescue_unit_price',
        'initial_quantity','remaining_quantity','order_id','order_quantity','order_status','order_unit_price']));
  }));
}
module.exports={registerTrainingData,loadDataset};
