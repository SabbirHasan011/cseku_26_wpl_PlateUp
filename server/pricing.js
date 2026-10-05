const {spawn}=require('node:child_process');
const path=require('node:path');
const pool=require('./db');
const {loadDataset}=require('./training-data');
const {eligibility,writeCsv}=require('./training-format');
const {PROFILES,generateItemHistory}=require('./synthetic-sales');
const {decidePrice,offerWindow,REFRESH_MS}=require('./pricing-policy');

function trainPython(rows) {
  return new Promise((resolve,reject)=>{
    let child;
    try {child=spawn(process.env.ML_PYTHON||'python',[path.join(__dirname,'..','ml','train.py')],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch {return reject(Object.assign(new Error('Python could not be started. Check ML_PYTHON and process permissions.'),{status:503}));}
    let output='',errors='';
    const timer=setTimeout(()=>{child.kill();reject(Object.assign(new Error('Model training timed out. The previous model and fallback remain available.'),{status:503}));},60000);
    child.on('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('Python is unavailable. Install ml/requirements.txt and configure ML_PYTHON.'),{status:503}));});
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000){child.kill();}});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      clearTimeout(timer);
      let value;try{value=JSON.parse(output);}catch{}
      if(code!==0||!value||value.error)return reject(Object.assign(new Error(value?.error||
        (errors.includes('ModuleNotFoundError')?'Install the Python packages in ml/requirements.txt.':'Could not train the pricing model. Check the Python installation.')),{status:code===2?422:503}));
      resolve(value);
    });
    child.stdin.end(JSON.stringify({rows}));
  });
}

// Runs on reads/checkout, not a scheduler. A DB timestamp bounds updates to once
// every three minutes. Locks use the same listing -> inventory order as checkout/quantity.
async function refreshPrices() {
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const locked=await db.query('SELECT pg_try_advisory_xact_lock(73621944) AS locked');
    if(!locked.rows[0].locked){await db.query('ROLLBACK');return;}
    const rows=(await db.query(`SELECT l.*,m.artifact,m.source AS model_source,
      a.id AS daily_id,a.offer_date::text,a.initial_quantity,a.remaining_quantity,a.last_price,a.last_priced_at
      FROM listings l LEFT JOIN pricing_models m ON m.listing_id=l.id
      LEFT JOIN daily_availability a ON a.listing_id=l.id AND a.offer_date=CASE
        WHEN l.offer_end_time<l.offer_start_time AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time<l.offer_end_time
        THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-1 ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date END
      WHERE l.is_active AND l.minimum_price IS NOT NULL
        AND (l.pricing_updated_at IS NULL OR l.pricing_updated_at<=NOW()-INTERVAL '3 minutes'
          OR l.rescue_price<>TRUNC(l.rescue_price) OR a.last_price<>TRUNC(a.last_price)
          OR (plateup_daily_status(a.offer_date,a.remaining_quantity,l.offer_start_time,l.offer_end_time,
            CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')='Active'
            AND (a.last_price IS NULL OR a.last_priced_at IS NULL OR a.last_priced_at<=NOW()-INTERVAL '3 minutes')))
      ORDER BY l.id FOR UPDATE OF l`)).rows;
    for(const item of rows) {
      if(item.daily_id) {
        const stock=(await db.query('SELECT initial_quantity,remaining_quantity,last_price,last_priced_at FROM daily_availability WHERE id=$1 FOR UPDATE',[item.daily_id])).rows[0];
        Object.assign(item,stock);
      }
      const artifact=item.artifact?.item_updated_at===new Date(item.updated_at).toISOString()?item.artifact:null;
      const now=new Date(),window=offerWindow(item);
      let decision;
      try {decision=decidePrice(item,artifact,now);}
      catch(error) {
        if(!(error instanceof RangeError))throw error;
        // An incompatible legacy boundary must not block every other item.
        await db.query('UPDATE listings SET pricing_reason=$2,pricing_updated_at=NOW() WHERE id=$1',[item.id,error.message]);
        continue;
      }
      // Keep the per-day clock through quantity edits and retraining.
      if(window && now>=window.start && now<window.end && Number(item.remaining_quantity)>0 &&
        (item.last_price==null || !item.last_priced_at || now-new Date(item.last_priced_at)>=REFRESH_MS))
        await db.query('UPDATE daily_availability SET last_price=$2,last_priced_at=$3 WHERE id=$1',[item.daily_id,decision.price,now]);
      else if(item.last_price!=null && !Number.isInteger(Number(item.last_price)))
        await db.query('UPDATE daily_availability SET last_price=$2 WHERE id=$1',[item.daily_id,decision.price]);
      await db.query(`UPDATE listings SET rescue_price=$2,pricing_source=$3,pricing_reason=$4,pricing_updated_at=NOW() WHERE id=$1`,
        [item.id,decision.price,decision.source,decision.reason]);
      if(['model','synthetic_model'].includes(decision.source) && (Number(item.rescue_price)!==decision.price || item.pricing_source!==decision.source))
        await db.query(`INSERT INTO ml_predictions(business_id,listing_id,prediction_type,predicted_value,prediction_date,model_source,details)
          VALUES ($1,$2,'price',$3,NOW(),$4,$5)`,[item.business_id,item.id,decision.price,decision.source,
          JSON.stringify({expected_remaining_collections:decision.expected,baseline_price:decision.baseline_price,
            policy_version:decision.policy_version,reason:decision.reason,model_trained_through:item.artifact.last_date})]);
    }
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

const training=new Set();
function historyReady(rows) {
  const eligible=rows.filter(row=>Number(row.initial_quantity)>0 && Number(row.original_unit_price)>0 && eligibility(row).training_eligible);
  return new Set(eligible.map(row=>row.offer_date)).size>=30 &&
    new Set(eligible.map(row=>(Number(row.rescue_unit_price)/Number(row.original_unit_price)).toFixed(2))).size>=3;
}
async function withPricingReadiness(user,items) {
  if(!items.length)return items;
  const [imports,models,native]=await Promise.all([
    pool.query('SELECT listing_id,data_source,record FROM training_records WHERE business_id=$1 AND listing_id=ANY($2::int[])',[user.userId,items.map(item=>item.id)]),
    pool.query('SELECT m.listing_id FROM pricing_models m JOIN listings l ON l.id=m.listing_id WHERE l.business_id=$1',[user.userId]),
    loadDataset(user)
  ]);
  const grouped=new Map();
  for(const row of imports.rows) {
    const key=row.listing_id+':'+row.data_source;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(row.record);
  }
  const modelIds=new Set(models.rows.map(model=>model.listing_id));
  return items.map(item=>({...item,pricing_readiness:
    ['model','synthetic_model'].includes(item.pricing_source)?'Model active':
    modelIds.has(item.id)?'Baseline active':
    [grouped.get(item.id+':real')||[],grouped.get(item.id+':synthetic')||[],
      native.rows.filter(row=>row.item_reference==='plateup:'+item.id)].some(historyReady)?'Ready to train':'History needed'}));
}
function registerPricing(app,{auth,role,wrap,validId}) {
  const guard=[auth,role('business')];
  async function owned(req) {
    if(!validId(req.params.id))throw Object.assign(new Error('Invalid item.'),{status:400});
    const item=(await pool.query('SELECT * FROM listings WHERE id=$1 AND business_id=$2 AND is_active',[req.params.id,req.user.userId])).rows[0];
    if(!item)throw Object.assign(new Error('Food item not found.'),{status:404});
    return item;
  }
  app.get('/api/business/listings/:id/pricing',...guard,wrap(async(req,res)=>{
    const item=await owned(req);
    const model=(await pool.query('SELECT artifact,source,trained_at FROM pricing_models WHERE listing_id=$1',[item.id])).rows[0];
    const imported=(await pool.query(`SELECT data_source,COUNT(*)::int AS records,MAX(imported_at) AS last_import
      FROM training_records WHERE listing_id=$1 GROUP BY data_source`,[item.id])).rows;
    const native=await loadDataset(req.user);
    const platform_count=native.rows.filter(r=>r.item_reference==='plateup:'+item.id&&r.training_eligible).length;
    if(model) {const {weights,intercept,...metrics}=model.artifact;model.artifact=metrics;}
    res.set('Cache-Control','private, no-store').json({item,model:model||null,imported,platform_count});
  }));
  app.post('/api/business/listings/:id/train',...guard,wrap(async(req,res)=>{
    const item=await owned(req),source=req.body.source;
    if(!['platform','restaurant','synthetic'].includes(source))return res.status(400).json({message:'Choose a history source.'});
    if(training.has(item.id)||training.size>=2)return res.status(429).json({message:'Training is already running. Try again shortly.'});
    training.add(item.id);
    try {
      let rows;
      if(source==='platform')rows=(await loadDataset(req.user)).rows.filter(r=>r.item_reference==='plateup:'+item.id&&r.training_eligible);
      else rows=(await pool.query(`SELECT record FROM training_records WHERE listing_id=$1 AND business_id=$2 AND data_source=$3 ORDER BY offer_date`,
        [item.id,req.user.userId,source==='synthetic'?'synthetic':'real'])).rows.map(r=>r.record).filter(r=>eligibility(r).training_eligible);
      if(rows.length>5000)return res.status(422).json({message:'Use at most 5,000 item history rows for this prototype.'});
      const artifact=await trainPython(rows);
      artifact.item_updated_at=new Date(item.updated_at).toISOString();
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        const current=(await db.query('SELECT updated_at,is_active FROM listings WHERE id=$1 FOR UPDATE',[item.id])).rows[0];
        if(!current?.is_active || new Date(current.updated_at).getTime()!==new Date(item.updated_at).getTime())throw Object.assign(new Error('Item changed during training. Retrain using its current settings.'),{status:409});
        await db.query(`INSERT INTO pricing_models(listing_id,artifact,source) VALUES($1,$2,$3)
          ON CONFLICT(listing_id) DO UPDATE SET artifact=EXCLUDED.artifact,source=EXCLUDED.source,trained_at=NOW()`,[item.id,JSON.stringify(artifact),source]);
        await db.query('UPDATE listings SET pricing_updated_at=NULL WHERE id=$1',[item.id]);
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
      await refreshPrices();
      res.json({message:artifact.reason,source,metrics:artifact});
    }finally{training.delete(item.id);}
  }));
  app.post('/api/business/listings/:id/sample',...guard,wrap(async(req,res)=>{
    const item=await owned(req);
    if(Number(item.original_price)<=0)return res.status(400).json({message:'Sample data requires a positive original price.'});
    const profile=PROFILES.find(p=>p.category===item.category)||PROFILES[0];
    const rows=generateItemHistory({...profile,slug:'demo-item-'+item.id,title:item.title,category:item.category,
      original_price:Number(item.original_price),minimum_price:Number(item.minimum_price),
      start:item.offer_start_time.slice(0,5),end:item.offer_end_time.slice(0,5)});
    res.json({csv:writeCsv(rows),count:rows.length,message:'Synthetic demonstration only; import and train explicitly.'});
  }));
}
module.exports={registerPricing,refreshPrices,trainPython,withPricingReadiness,historyReady};
