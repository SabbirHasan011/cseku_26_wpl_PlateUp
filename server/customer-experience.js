const pool=require('./db');
const {expireOrders}=require('./order-lifecycle');

function registerCustomerExperience(app,{auth,role,wrap,validId,listingSql,restaurantSql,viewerCitySql}) {
  app.get('/api/favorites',auth,role('customer'),wrap(async(req,res)=>{
    const id=req.user.userId;
    const [refs,restaurants,listings]=await Promise.all([
      pool.query(`SELECT f.listing_id,f.business_id,COALESCE(l.title,b.business_name) AS title FROM favorites f
        LEFT JOIN listings l ON l.id=f.listing_id LEFT JOIN businesses b ON b.user_id=f.business_id
        WHERE f.customer_id=$1 ORDER BY f.id DESC`,[id]),
      pool.query(`${restaurantSql} AND b.user_id IN (SELECT business_id FROM favorites WHERE customer_id=$1) ORDER BY b.business_name`,[id]),
      pool.query(`SELECT * FROM (${listingSql}) items WHERE is_active=TRUE AND daily_status='Active' AND city_id=${viewerCitySql}
        AND business_id IN (SELECT id FROM users WHERE status='active' AND role='business')
        AND id IN (SELECT listing_id FROM favorites WHERE customer_id=$1) ORDER BY title`,[id])
    ]);
    res.set('Cache-Control','private, no-store');
    res.json({saved:refs.rows,restaurants:restaurants.rows,listings:listings.rows});
  }));
  app.put('/api/favorites/:kind/:id',auth,role('customer'),wrap(async(req,res)=>{
    const {kind,id}=req.params;
    if (!['listing','business'].includes(kind) || !validId(id)) return res.status(400).json({message:'Invalid favorite.'});
    const found=kind==='listing'
      ? await pool.query(`SELECT id FROM (${listingSql}) items WHERE id=$2 AND is_active=TRUE AND daily_status='Active' AND city_id=${viewerCitySql}
          AND business_id IN (SELECT id FROM users WHERE status='active' AND role='business')`,[req.user.userId,id])
      : await pool.query(`${restaurantSql} AND b.user_id=$1`,[id]);
    if (!found.rows.length) return res.status(404).json({message:'This item or restaurant is unavailable.'});
    await pool.query(`INSERT INTO favorites(customer_id,${kind==='listing'?'listing_id':'business_id'}) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[req.user.userId,id]);
    res.json({message:'Added to favorites.'});
  }));
  app.delete('/api/favorites/:kind/:id',auth,role('customer'),wrap(async(req,res)=>{
    const {kind,id}=req.params;
    if (!['listing','business'].includes(kind) || !validId(id)) return res.status(400).json({message:'Invalid favorite.'});
    await pool.query(`DELETE FROM favorites WHERE customer_id=$1 AND ${kind==='listing'?'listing_id':'business_id'}=$2`,[req.user.userId,id]);
    res.json({message:'Removed from favorites.'});
  }));
  app.get('/api/business/analytics/daily',auth,role('business'),wrap(async(req,res)=>{
    const today=(await pool.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date::text AS day")).rows[0].day;
    const to=req.query.to||today;
    const from=req.query.from||new Date(Date.parse(today+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
    const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
    if (!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>365*86400000)
      return res.status(400).json({message:'Choose a valid date range of up to 366 days.'});
    await expireOrders(req.user);
    const rows=(await pool.query(`SELECT a.offer_date::text AS date,SUM(a.initial_quantity)::int AS offered,
      SUM(COALESCE(o.reserved,0))::int AS reserved,SUM(COALESCE(o.collected,0))::int AS collected,
      SUM(a.remaining_quantity)::int AS remaining,SUM(COALESCE(o.missed,0))::int AS missed,
      SUM(COALESCE(o.revenue,0))::numeric AS revenue
      FROM daily_availability a JOIN listings l ON l.id=a.listing_id
      LEFT JOIN (SELECT daily_availability_id,
        SUM(quantity) FILTER (WHERE status IN ('pending','confirmed','ready')) AS reserved,
        SUM(quantity) FILTER (WHERE status='completed') AS collected,
        SUM(quantity) FILTER (WHERE status='expired') AS missed,
        SUM(total_price) FILTER (WHERE status='completed') AS revenue
        FROM orders GROUP BY daily_availability_id) o ON o.daily_availability_id=a.id
      WHERE l.business_id=$1 AND a.offer_date BETWEEN $2::date AND $3::date
      GROUP BY a.offer_date ORDER BY a.offer_date DESC`,[req.user.userId,from,to])).rows;
    res.set('Cache-Control','private, no-store');
    if (req.query.format==='csv') {
      // These columns contain dates and numeric aggregates only, never spreadsheet formulas.
      const columns=['date','offered','reserved','collected','remaining','missed','revenue'];
      res.type('text/csv').attachment('plateup-sales-'+from+'-to-'+to+'.csv');
      return res.send(columns.join(',')+'\r\n'+rows.map(row=>columns.map(key=>row[key]).join(',')).join('\r\n'));
    }
    res.json({from,to,days:rows});
  }));
}
module.exports={registerCustomerExperience};
