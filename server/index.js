const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const pool = require('./db');
const { expireOrders,expireLockedOrder } = require('./order-lifecycle');
const { registerAccountSecurity } = require('./account-security');
const { registerCustomerExperience } = require('./customer-experience');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
const foodUploadDir = path.join(__dirname, 'uploads', 'food');
app.use('/uploads/food', express.static(foodUploadDir, { fallthrough:false,
  setHeaders:res => res.setHeader('X-Content-Type-Options','nosniff') }));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'UI_PlateUp.html')));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const clean = (value, max = 255) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
// Only trusted SQL column expressions are passed here. Empty cities never match.
const viewerCitySql = `(SELECT COALESCE(c.city_id,b.city_id) FROM users viewer
  LEFT JOIN customers c ON c.user_id=viewer.id
  LEFT JOIN businesses b ON b.user_id=viewer.id WHERE viewer.id=$1)`;
const listingSql = `WITH clock AS (SELECT CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka' AS local_now)
  SELECT l.id,l.title,l.description,l.category,l.business_id,l.original_price,l.rescue_price,
    l.image_path,l.offer_start_time,l.offer_end_time,l.is_active,l.created_at,l.updated_at,
    b.business_name,b.address AS pickup_address,b.city,b.city_id,
    ratings.average_rating,COALESCE(ratings.review_count,0) AS review_count,
    a.id AS daily_availability_id,a.offer_date::text AS offer_date,
    a.initial_quantity,a.remaining_quantity,a.remaining_quantity AS quantity,
    CASE WHEN a.id IS NULL AND previous_a.id IS NOT NULL AND
      l.offer_end_time<l.offer_start_time AND
      clock.local_now::time>=l.offer_end_time AND clock.local_now::time<l.offer_start_time
      THEN 'Closed for Today'
      ELSE plateup_daily_status(a.offer_date,a.remaining_quantity,l.offer_start_time,
        l.offer_end_time,clock.local_now) END AS daily_status,
    a.offer_date + l.offer_start_time AS available_from,
    a.offer_date + l.offer_end_time + CASE WHEN l.offer_end_time<=l.offer_start_time
      THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END AS available_until
  FROM listings l JOIN businesses b ON b.user_id=l.business_id
  LEFT JOIN (SELECT listing_id,ROUND(AVG(rating),1) AS average_rating,COUNT(*)::int AS review_count
    FROM reviews WHERE listing_id IS NOT NULL GROUP BY listing_id) ratings ON ratings.listing_id=l.id
  CROSS JOIN clock
  CROSS JOIN LATERAL (SELECT CASE WHEN l.offer_end_time<l.offer_start_time
    AND clock.local_now::time<l.offer_end_time THEN clock.local_now::date-1
    ELSE clock.local_now::date END AS offer_date) day
  LEFT JOIN daily_availability a ON a.listing_id=l.id AND a.offer_date=day.offer_date
  LEFT JOIN daily_availability previous_a ON previous_a.listing_id=l.id
    AND previous_a.offer_date=clock.local_now::date-1`;
const orderSql = `SELECT o.*,l.title AS listing_title,l.business_id,b.business_name,
  b.address AS pickup_address,b.city FROM orders o JOIN listings l ON l.id=o.listing_id
  JOIN businesses b ON b.user_id=l.business_id`;
const reviewSql = `SELECT r.*,b.business_name,u.name AS author_name,
  COALESCE(l.title,r.item_name) AS item_name FROM reviews r
  JOIN businesses b ON b.user_id=r.business_id JOIN users u ON u.id=r.customer_id
  LEFT JOIN listings l ON l.id=r.listing_id`;
const restaurantSql = `SELECT b.user_id AS id,b.business_name,b.description,b.address,b.city,
    b.opening_time,b.closing_time,ratings.average_rating,COALESCE(ratings.review_count,0) AS review_count
  FROM businesses b JOIN users u ON u.id=b.user_id
  LEFT JOIN (SELECT business_id,ROUND(AVG(rating),1) AS average_rating,COUNT(*)::int AS review_count
    FROM reviews GROUP BY business_id) ratings ON ratings.business_id=b.user_id
  WHERE u.role='business' AND u.status='active'`;
const imageUpload = multer({ storage:multer.memoryStorage(),
  limits:{ fileSize:5*1024*1024,files:1,fields:10,parts:11 },
  fileFilter:(_,file,callback) => {
    if (!['image/jpeg','image/png','image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPG, PNG, or WebP image.'); error.status = 400;
      return callback(error);
    }
    callback(null,true);
  }
});
function imageExtension(buffer) {
  if (buffer.length>=3 && buffer[0]===0xff && buffer[1]===0xd8 && buffer[2]===0xff) return '.jpg';
  if (buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return '.png';
  if (buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' &&
    buffer.toString('ascii',8,12)==='WEBP') return '.webp';
  return null;
}
async function saveImage(file) {
  if (!file) return null;
  const extension=imageExtension(file.buffer);
  if (!extension || (extension==='.jpg' && file.mimetype!=='image/jpeg') ||
    (extension==='.png' && file.mimetype!=='image/png') ||
    (extension==='.webp' && file.mimetype!=='image/webp')) {
    const error=new Error('The uploaded file is not a valid JPG, PNG, or WebP image.');
    error.status=400; throw error;
  }
  await fs.mkdir(foodUploadDir,{ recursive:true });
  const filename=crypto.randomUUID()+extension;
  await fs.writeFile(path.join(foodUploadDir,filename),file.buffer,{ flag:'wx' });
  return '/uploads/food/'+filename;
}
async function removeImage(imagePath) {
  if (/^\/uploads\/food\/[0-9a-f-]+\.(jpg|png|webp)$/.test(imagePath||''))
    await fs.unlink(path.join(foodUploadDir,path.basename(imagePath))).catch(error => {
      if (error.code!=='ENOENT') console.error('Could not remove unused image',error);
    });
}

function auth(req, res, next) {
  const token = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1];
  if (!token) return res.status(401).json({ message: 'Sign in required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    pool.query('SELECT role,status,auth_version FROM users WHERE id=$1', [decoded.userId]).then(result => {
      if (!result.rows.length || result.rows[0].status !== 'active' || result.rows[0].role !== decoded.role || result.rows[0].auth_version!==(decoded.version||0))
        return res.status(401).json({ message: 'Account unavailable' });
      req.user = decoded;
      next();
    }).catch(next);
  }
  catch (_) { res.status(401).json({ message: 'Session expired or invalid' }); }
}
const role = name => (req, res, next) => req.user.role === name ? next()
  : res.status(403).json({ message: 'This account cannot perform that action' });
const optionalAuth = (req,res,next) => req.get('Authorization') ? auth(req,res,next) : next();
registerAccountSecurity(app,{auth,wrap});
registerCustomerExperience(app,{auth,role,wrap,validId,listingSql,restaurantSql,viewerCitySql});
function publicOrder(order,user) {
  const { pickup_code,pickup_attempts,pickup_locked_until,...safe } = order;
  if (user.role==='customer' && user.userId===order.customer_id && ['pending','confirmed','ready'].includes(order.status))
    safe.pickup_code=pickup_code;
  return safe;
}
async function notifyOrder(db,userId,orderId,event,message) {
  await db.query(`INSERT INTO notifications(user_id,order_id,event,message) VALUES ($1,$2,$3,$4)
    ON CONFLICT(user_id,order_id,event) DO NOTHING`,[userId,orderId,event,message]);
}
function cartInput(body) {
  const items=Array.isArray(body.items)?body.items:[{ listing_id:body.listing_id,quantity:body.quantity }];
  if (!items.length || items.length>30 || items.some(item=>!item || !validId(item.listing_id) || !validId(item.quantity) || Number(item.quantity)>100000)) return null;
  const grouped=new Map();
  for (const item of items) {
    const id=Number(item.listing_id), previous=grouped.get(id);
    const price=item.unit_price==null?null:Number(item.unit_price);
    if (price!==null && (!Number.isFinite(price) || price<0)) return null;
    if (previous && previous.unit_price!==price) return null;
    grouped.set(id,{ listing_id:id,quantity:(previous?.quantity||0)+Number(item.quantity),unit_price:price });
    if (grouped.get(id).quantity>100000) return null;
  }
  return [...grouped.values()].sort((a,b)=>a.listing_id-b.listing_id);
}

app.get('/api/cities',wrap(async (_,res)=>{
  res.json((await pool.query('SELECT id,name,aliases FROM cities ORDER BY name')).rows);
}));

app.get('/api/categories',wrap(async (_,res)=>{
  res.json((await pool.query('SELECT id,name FROM food_categories ORDER BY LOWER(name),id')).rows);
}));
app.post('/api/categories',auth,role('business'),wrap(async (req,res)=>{
  const name=typeof req.body.name==='string' ? req.body.name.trim().replace(/\s+/g,' ') : '';
  if (!name || name.length>100 || /[\x00-\x1F\x7F]/.test(name))
    return res.status(400).json({ message:'Enter a category name between 1 and 100 characters.' });
  const result=await pool.query(`INSERT INTO food_categories(name) VALUES ($1)
    ON CONFLICT DO NOTHING RETURNING id,name`,[name]);
  if (!result.rows.length) return res.status(409).json({ message:'This category already exists. Choose it from the dropdown.' });
  res.status(201).json({ category:result.rows[0] });
}));

app.get('/api/health', wrap(async (_, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/signup', wrap(async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const password = req.body.password;
  const kind = req.body.role || 'customer';
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string'
    || password.length < 8 || !['customer','business'].includes(kind))
    return res.status(400).json({ message: 'Enter a name, valid email, password of at least 8 characters, and account role' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
      [name,email,hash,kind]);
    const user = result.rows[0];
    if (kind === 'customer') await db.query('INSERT INTO customers (user_id) VALUES ($1)', [user.id]);
    else await db.query('INSERT INTO businesses (user_id,business_name) VALUES ($1,$2)', [user.id,name]);
    await db.query('COMMIT');
    res.status(201).json({ user });
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ message: 'Email already exists' });
    throw error;
  } finally { db.release(); }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const { password, role: kind } = req.body;
  if (!email || !password || !kind) return res.status(400).json({ message: 'Email, password, and role are required' });
  const result = await pool.query("SELECT * FROM users WHERE email=$1 AND role=$2 AND status='active'", [email,kind]);
  const user = result.rows[0];
  if (!user || !await bcrypt.compare(password,user.password_hash))
    return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ userId:user.id,email:user.email,role:user.role,version:user.auth_version },process.env.JWT_SECRET,{ expiresIn:'1h' });
  res.json({ token,user:{ id:user.id,name:user.name,email:user.email,role:user.role } });
}));

app.get('/api/me', auth, wrap(async (req,res) => {
  const result = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.phone,u.status,u.created_at,
    c.address AS customer_address,c.city AS customer_city,c.city_id AS customer_city_id,c.preferred_location,
    b.business_name,b.description,b.address AS business_address,b.city AS business_city,b.city_id AS business_city_id,
    b.phone AS business_phone,b.latitude,b.longitude,b.opening_time,b.closing_time
    FROM users u LEFT JOIN customers c ON c.user_id=u.id
    LEFT JOIN businesses b ON b.user_id=u.id WHERE u.id=$1 AND u.status='active'`,[req.user.userId]);
  if (!result.rows.length) return res.status(401).json({ message: 'Account unavailable' });
  res.json({ profile:result.rows[0] });
}));

app.put('/api/me', auth, wrap(async (req,res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ message: 'Name is required' });
  let city=null;
  const cityProvided=Object.hasOwn(req.body,'city_id') || Object.hasOwn(req.body,'city');
  if (req.body.city_id!=null && req.body.city_id!=='') {
    if (!validId(req.body.city_id)) return res.status(400).json({ message:'Select a city from the list.' });
    city=(await pool.query('SELECT id,name FROM cities WHERE id=$1',[req.body.city_id])).rows[0];
    if (!city) return res.status(400).json({ message:'Select a city from the list.' });
  } else if (!Object.hasOwn(req.body,'city_id') && clean(req.body.city)) {
    const value=clean(req.body.city).replace(/\s+/g,' ').toLowerCase();
    city=(await pool.query('SELECT id,name FROM cities WHERE LOWER(name)=$1 OR $1=ANY(aliases)',[value])).rows[0];
    if (!city) return res.status(400).json({ message:'Select a city from the list.' });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('UPDATE users SET name=$1,phone=$2,updated_at=NOW() WHERE id=$3',
      [name,clean(req.body.phone,50)||null,req.user.userId]);
    if (req.user.role === 'customer') {
      await db.query('UPDATE customers SET address=$1,preferred_location=$2 WHERE user_id=$3',
        [clean(req.body.address,2000)||null,clean(req.body.preferred_location)||null,req.user.userId]);
    } else if (req.user.role === 'business') {
      const latitude = req.body.latitude === '' || req.body.latitude == null ? null : Number(req.body.latitude);
      const longitude = req.body.longitude === '' || req.body.longitude == null ? null : Number(req.body.longitude);
      if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
        await db.query('ROLLBACK');
        return res.status(400).json({ message:'Invalid coordinates' });
      }
      await db.query(`UPDATE businesses SET business_name=$1,description=$2,address=$3,city=CASE WHEN $11 THEN $4 ELSE city END,
        phone=$5,opening_time=$6,closing_time=$7,latitude=$9,longitude=$10 WHERE user_id=$8`,
        [clean(req.body.business_name)||name,clean(req.body.description,2000)||null,
          clean(req.body.address,2000)||null,city?.name||null,clean(req.body.phone,50)||null,
          req.body.opening_time||null,req.body.closing_time||null,req.user.userId,latitude,longitude,cityProvided]);
    }
    if (cityProvided && ['customer','business'].includes(req.user.role)) {
      const table=req.user.role==='customer'?'customers':'businesses';
      await db.query(`UPDATE ${table} SET city_id=$1,city=$2 WHERE user_id=$3`,[city?.id||null,city?.name||null,req.user.userId]);
    }
    await db.query('COMMIT');
    res.json({ message:'Profile updated' });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));

app.get('/api/restaurants', optionalAuth, wrap(async (_,res) => {
  const result=await pool.query(`${restaurantSql} ORDER BY LOWER(b.business_name),b.user_id`);
  res.set('Cache-Control','private, no-store');
  res.json(result.rows);
}));
app.get('/api/restaurants/:id', optionalAuth, wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid restaurant ID' });
  const restaurant=await pool.query(`${restaurantSql} AND b.user_id=$1`,[req.params.id]);
  if (!restaurant.rows.length) return res.status(404).json({ message:'Restaurant not found' });
  const menu=await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE business_id=$2 AND is_active=TRUE AND daily_status='Active'
    AND city_id=${viewerCitySql} ORDER BY title,id`,[req.user?.userId || null,req.params.id]);
  res.set('Cache-Control','private, no-store');
  res.json({ restaurant:restaurant.rows[0],listings:menu.rows });
}));

app.get('/api/listings', optionalAuth, wrap(async (req,res) => {
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE is_active=TRUE AND daily_status='Active' AND city_id=${viewerCitySql}
    ORDER BY id DESC`,[req.user?.userId || null]);
  res.set('Cache-Control','private, no-store');
  res.json(result.rows);
}));
app.get('/api/business/listings', auth, role('business'), wrap(async (req,res) => {
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE business_id=$1 AND is_active=TRUE ORDER BY id DESC`,[req.user.userId]);
  res.json(result.rows);
}));
app.get('/api/business/listings/:id', auth, role('business'), wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid item ID' });
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE id=$1 AND business_id=$2 AND is_active=TRUE`,[req.params.id,req.user.userId]);
  if (!result.rows.length) return res.status(404).json({ message:'Food item not found' });
  res.json({ listing:result.rows[0] });
}));
app.get('/api/listings/:id', optionalAuth, wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid listing ID' });
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE id=$2 AND is_active=TRUE AND daily_status='Active'
    AND city_id=${viewerCitySql}`,[req.user?.userId || null,req.params.id]);
  if (!result.rows.length) return res.status(404).json({ message:'Listing not found' });
  res.set('Cache-Control','private, no-store');
  res.json({ listing:result.rows[0] });
}));

async function listingInput(body) {
  const title = clean(body.title), category = typeof body.category==='string' ? body.category.trim() : '';
  const original = Number(body.original_price), rescue = Number(body.rescue_price);
  const start = clean(body.offer_start_time,5), end = clean(body.offer_end_time,5);
  if (!title || !category || body.original_price==='' || body.rescue_price==='' ||
    !Number.isFinite(original) || original<0 ||
    !Number.isFinite(rescue) || rescue<0 || rescue>original ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end))
    return { error:'Enter a title, category, valid prices, and daily offer start/end times.' };
  const saved=await pool.query('SELECT name FROM food_categories WHERE LOWER(name)=LOWER($1)',[category]);
  if (!saved.rows.length) return { error:'Choose a saved category, or use Add Category first.' };
  return { values:[title,saved.rows[0].name,clean(body.description,2000)||null,original,rescue,start,end] };
}
app.post('/api/listings', auth, role('business'), imageUpload.single('image'), wrap(async (req,res) => {
  const parsed = await listingInput(req.body);
  if (parsed.error) return res.status(400).json({ message:parsed.error });
  let imagePath=null;
  let imageCommitted=false;
  try {
    imagePath=await saveImage(req.file);
    const created = await pool.query(`INSERT INTO listings
      (business_id,business_name,title,category,description,original_price,rescue_price,
       offer_start_time,offer_end_time,image_path,quantity,status,is_active)
      SELECT b.user_id,b.business_name,$2,$3,$4,$5,$6,$7,$8,$9,0,'sold_out',TRUE
      FROM businesses b WHERE b.user_id=$1 RETURNING id`,
      [req.user.userId,...parsed.values,imagePath]);
    imageCommitted=true;
    const result = await pool.query(`SELECT * FROM (${listingSql}) items WHERE id=$1`,[created.rows[0].id]);
    res.status(201).json({ listing:result.rows[0] });
  } catch(error) { if (!imageCommitted) await removeImage(imagePath); throw error; }
}));
app.put('/api/listings/:id', auth, role('business'), imageUpload.single('image'), wrap(async (req,res) => {
  const parsed = await listingInput(req.body);
  if (!validId(req.params.id)||parsed.error) return res.status(400).json({ message:parsed.error||'Invalid listing ID' });
  const own=await pool.query('SELECT image_path FROM listings WHERE id=$1 AND business_id=$2 AND is_active=TRUE',
    [req.params.id,req.user.userId]);
  if (!own.rows.length) return res.status(404).json({ message:'Food item not found' });
  let imagePath=null;
  let imageCommitted=false;
  try {
    imagePath=await saveImage(req.file);
    const updated = await pool.query(`UPDATE listings SET title=$1,category=$2,description=$3,
      original_price=$4,rescue_price=$5,offer_start_time=$6,offer_end_time=$7,
      image_path=COALESCE($8,image_path),updated_at=NOW()
      WHERE id=$9 AND business_id=$10 AND is_active=TRUE RETURNING id`,
      [...parsed.values,imagePath,req.params.id,req.user.userId]);
    if (!updated.rows.length) {
      await removeImage(imagePath);
      return res.status(404).json({ message:'Food item not found' });
    }
    imageCommitted=true;
    const result = await pool.query(`SELECT * FROM (${listingSql}) items WHERE id=$1`,[req.params.id]);
    if (imagePath) await removeImage(own.rows[0].image_path);
    res.json({ listing:result.rows[0] });
  } catch(error) { if (!imageCommitted) await removeImage(imagePath); throw error; }
}));
app.delete('/api/listings/:id', auth, role('business'), wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid listing ID' });
  const result = await pool.query("UPDATE listings SET is_active=FALSE,status='inactive',updated_at=NOW() WHERE id=$1 AND business_id=$2 AND is_active=TRUE RETURNING id",
    [req.params.id,req.user.userId]);
  if (!result.rows.length) return res.status(404).json({ message:'Listing not found' });
  res.json({ message:'Listing deactivated',id:result.rows[0].id });
}));
app.put('/api/listings/:id/today', auth, role('business'), wrap(async (req,res) => {
  if (!validId(req.params.id) || !Number.isSafeInteger(Number(req.body.initial_quantity)) ||
    Number(req.body.initial_quantity)<0 || req.body.initial_quantity==='' || req.body.initial_quantity==null)
    return res.status(400).json({ message:'Enter a non-negative whole-number quantity.' });
  const quantity=Number(req.body.initial_quantity);
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const own=await db.query(`SELECT id,offer_start_time,offer_end_time FROM listings
      WHERE id=$1 AND business_id=$2 AND is_active=TRUE FOR UPDATE`,[req.params.id,req.user.userId]);
    if (!own.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ message:'Food item not found' }); }
    const dateResult=await db.query(`SELECT (CASE WHEN $1::time<$2::time AND
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time<$1::time
      THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-1
      ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date END)::text AS offer_date`,
      [own.rows[0].offer_end_time,own.rows[0].offer_start_time]);
    const saved=await db.query(`INSERT INTO daily_availability
      (listing_id,offer_date,initial_quantity,remaining_quantity) VALUES ($1,$2,$3,$3)
      ON CONFLICT (listing_id,offer_date) DO UPDATE SET
        initial_quantity=EXCLUDED.initial_quantity,
        remaining_quantity=EXCLUDED.initial_quantity-
          (daily_availability.initial_quantity-daily_availability.remaining_quantity),
        updated_at=NOW()
      WHERE EXCLUDED.initial_quantity>=
        daily_availability.initial_quantity-daily_availability.remaining_quantity
      RETURNING id`,[req.params.id,dateResult.rows[0].offer_date,quantity]);
    if (!saved.rows.length) {
      await db.query('ROLLBACK');
      return res.status(409).json({ message:'Quantity cannot be less than units already reserved today.' });
    }
    await db.query('COMMIT');
    const result=await pool.query(`SELECT * FROM (${listingSql}) items WHERE id=$1`,[req.params.id]);
    res.json({ listing:result.rows[0] });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));

app.post('/api/cart/quote',auth,role('customer'),wrap(async (req,res)=>{
  const input=cartInput(req.body);
  if (!input) return res.status(400).json({ message:'Choose valid listings and positive quantities.' });
  const found=await pool.query(`SELECT *,available_until AT TIME ZONE 'Asia/Dhaka' AS pickup_deadline FROM (${listingSql}) items WHERE id=ANY($2::int[])
    AND is_active=TRUE AND daily_status='Active' AND city_id=${viewerCitySql}`,
    [req.user.userId,input.map(item=>item.listing_id)]);
  const items=input.map(requested=>{
    const item=found.rows.find(row=>row.id===requested.listing_id);
    return { listing_id:requested.listing_id,quantity:requested.quantity,title:item?.title,
      business_name:item?.business_name,image_path:item?.image_path,pickup_deadline:item?.pickup_deadline,
      unit_price:item?Number(item.rescue_price):null,available_quantity:item?.quantity||0,
      total_price:item?Number((Number(item.rescue_price)*requested.quantity).toFixed(2)):0,
      error:!item?'No longer available in your city.':requested.quantity>item.quantity?
        'Only '+item.quantity+' portions remain.':null };
  });
  res.set('Cache-Control','private, no-store');
  res.json({ items,valid:items.every(item=>!item.error),
    total_price:Number(items.reduce((sum,item)=>sum+item.total_price,0).toFixed(2)) });
}));
app.post('/api/orders', auth, role('customer'), wrap(async (req,res) => {
  const items=cartInput(req.body);
  if (!items)
    return res.status(400).json({ message:'Choose valid listings and positive quantities' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const orders=[];
    for (const { listing_id:listingId,quantity,unit_price } of items) {
      const stock = await db.query(`UPDATE daily_availability a SET
        remaining_quantity=a.remaining_quantity-$1,updated_at=NOW()
        FROM listings l WHERE a.listing_id=l.id AND l.id=$2 AND l.is_active=TRUE
        AND EXISTS (SELECT 1 FROM businesses b JOIN customers c ON c.user_id=$3
          WHERE b.user_id=l.business_id AND b.city_id=c.city_id)
        AND ($4::numeric IS NULL OR l.rescue_price=$4)
        AND a.offer_date=CASE WHEN l.offer_end_time<l.offer_start_time AND
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time<l.offer_end_time
          THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-1
          ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date END
        AND a.remaining_quantity>=$1
        AND plateup_daily_status(a.offer_date,a.remaining_quantity,l.offer_start_time,
          l.offer_end_time,CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')='Active'
        RETURNING a.id,l.rescue_price,l.business_id,l.title,
          (a.offer_date+l.offer_end_time+CASE WHEN l.offer_end_time<=l.offer_start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END)
          AT TIME ZONE 'Asia/Dhaka' AS pickup_deadline`,[quantity,listingId,req.user.userId,unit_price]);
      if (!stock.rows.length) {
        await db.query('ROLLBACK');
        return res.status(409).json({ message:'An item has changed price, is outside your saved city, or no longer has enough stock. Review your cart and try again.' });
      }
      const total = Number(stock.rows[0].rescue_price)*quantity;
      const created = await db.query(`INSERT INTO orders
        (customer_id,listing_id,daily_availability_id,quantity,total_price,payment_method,pickup_deadline)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.userId,listingId,stock.rows[0].id,quantity,total,
          clean(req.body.payment_method,50)||'Pay at pickup',stock.rows[0].pickup_deadline]);
      const order=created.rows[0];
      const code=order.id+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
      await db.query('UPDATE orders SET pickup_code=$1 WHERE id=$2',[code,order.id]);
      orders.push(publicOrder({ ...order,pickup_code:code },req.user));
      await notifyOrder(db,stock.rows[0].business_id,order.id,'new_order',
        'New reservation #'+order.id+': '+quantity+' portions of '+stock.rows[0].title+'.');
    }
    await db.query('COMMIT');
    res.status(201).json({ orders });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));
app.get('/api/orders', auth, wrap(async (req,res) => {
  await expireOrders(req.user);
  const condition = req.user.role==='customer'?'o.customer_id=$1':'l.business_id=$1';
  const result = await pool.query(`${orderSql} WHERE ${condition} ORDER BY o.id DESC`,[req.user.userId]);
  res.set('Cache-Control','private, no-store');
  res.json(result.rows.map(order=>publicOrder(order,req.user)));
}));
app.patch('/api/orders/:id', auth, wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid order ID' });
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const found=await db.query(`${orderSql} WHERE o.id=$1 FOR UPDATE OF o`,[req.params.id]);
    const order=found.rows[0];
    if (!order) { await db.query('ROLLBACK'); return res.status(404).json({ message:'Order not found' }); }
    const customer=req.user.role==='customer'&&order.customer_id===req.user.userId;
    const business=req.user.role==='business'&&order.business_id===req.user.userId;
    if (!customer&&!business) { await db.query('ROLLBACK'); return res.status(403).json({ message:'Order does not belong to this account' }); }
    if (['pending','confirmed','ready'].includes(order.status) && order.pickup_deadline && new Date(order.pickup_deadline)<=new Date()) {
      await expireLockedOrder(db,order); await db.query('COMMIT');
      return res.status(409).json({message:'The pickup deadline has passed. This reservation has expired.'});
    }
    const next=req.body.status;
    const rejection=business && next==='rejected' && ['pending','confirmed','ready'].includes(order.status);
    const reason=clean(req.body.reason,500);
    if (rejection && !reason) { await db.query('ROLLBACK'); return res.status(400).json({message:'Enter a reason for rejecting this reservation.'}); }
    const allowed=customer?['pending','confirmed'].includes(order.status)&&next==='cancelled'
      :rejection || ({ pending:'confirmed',confirmed:'ready',ready:'completed' })[order.status]===next;
    if (!allowed) { await db.query('ROLLBACK'); return res.status(400).json({ message:'Invalid order status change' }); }
    if (next==='completed') {
      const locked=order.pickup_locked_until && new Date(order.pickup_locked_until).getTime()>Date.now();
      if (locked) { await db.query('ROLLBACK'); return res.status(429).json({ message:'Too many incorrect pickup codes. Try again in five minutes.' }); }
      const supplied=clean(req.body.pickup_code,100).toUpperCase();
      if (!order.pickup_code || supplied!==order.pickup_code) {
        await db.query(`UPDATE orders SET pickup_attempts=CASE WHEN pickup_locked_until IS NOT NULL THEN 1 ELSE pickup_attempts+1 END,
          pickup_locked_until=CASE WHEN pickup_locked_until IS NULL AND pickup_attempts>=4 THEN NOW()+INTERVAL '5 minutes' ELSE NULL END
          WHERE id=$1`,[order.id]);
        await db.query('COMMIT');
        return res.status(400).json({ message:'Incorrect pickup code. Ask the customer for the code shown in their order.' });
      }
    }
    const updated=await db.query(`UPDATE orders SET status=$1::varchar,updated_at=NOW(),status_reason=$3,
      pickup_time=CASE WHEN $1::varchar='completed' THEN NOW() ELSE pickup_time END,
      pickup_attempts=0,pickup_locked_until=NULL,
      payment_status=CASE WHEN $1::varchar='completed' AND payment_method='Pay at pickup' THEN 'paid'
      ELSE payment_status END WHERE id=$2 RETURNING *`,[next,order.id,rejection?reason:null]);
    if (['cancelled','rejected'].includes(next) && order.daily_availability_id) await db.query(`UPDATE daily_availability
      SET remaining_quantity=remaining_quantity+$1,updated_at=NOW() WHERE id=$2`,
      [order.quantity,order.daily_availability_id]);
    if (next==='completed') await db.query(`INSERT INTO sales_data
      (business_id,listing_id,order_id,quantity_sold,price) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id) DO NOTHING`,
      [order.business_id,order.listing_id,order.id,order.quantity,order.total_price]);
    await notifyOrder(db,customer?order.business_id:order.customer_id,order.id,next,
      'Reservation #'+order.id+' for '+order.listing_title+' is '+(next==='ready'?'ready for pickup':next)+'.'+(rejection?' Reason: '+reason:''));
    await db.query('COMMIT');
    res.json({ order:publicOrder(updated.rows[0],req.user) });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));

app.get('/api/notifications',auth,wrap(async (req,res)=>{
  await expireOrders(req.user);
  const [items,unread]=await Promise.all([
    pool.query('SELECT id,order_id,event,message,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50',[req.user.userId]),
    pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[req.user.userId])
  ]);
  res.set('Cache-Control','private, no-store');
  res.json({ notifications:items.rows,unread_count:unread.rows[0].count });
}));
app.patch('/api/notifications/read',auth,wrap(async (req,res)=>{
  if (!validId(req.body.through_id)) return res.status(400).json({ message:'Invalid notification ID.' });
  await pool.query('UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND id<=$2 AND read_at IS NULL',
    [req.user.userId,req.body.through_id]);
  res.json({ message:'Notifications marked as read.' });
}));
app.patch('/api/notifications/:id/read',auth,wrap(async (req,res)=>{
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid notification ID.' });
  const result=await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING id',
    [req.params.id,req.user.userId]);
  if (!result.rows.length) return res.status(404).json({ message:'Notification not found.' });
  res.json({ message:'Notification marked as read.' });
}));

app.get('/api/reviews', wrap(async (_,res) => {
  const result=await pool.query(`${reviewSql} ORDER BY r.id DESC`);
  res.json(result.rows);
}));
app.get('/api/reviews/:id', wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid review ID' });
  const result=await pool.query(`${reviewSql} WHERE r.id=$1`,[req.params.id]);
  if (!result.rows.length) return res.status(404).json({ message:'Review not found' });
  res.json({ review:result.rows[0] });
}));
app.post('/api/reviews', auth, role('customer'), wrap(async (req,res) => {
  const orderId=Number(req.body.order_id),rating=Number(req.body.rating),comment=clean(req.body.comment,5000);
  if (!validId(orderId)||!Number.isInteger(rating)||rating<1||rating>5||!comment)
    return res.status(400).json({ message:'Completed order, 1–5 rating, and comment are required' });
  const found=await pool.query(`${orderSql} WHERE o.id=$1 AND o.customer_id=$2 AND o.status='completed'`,
    [orderId,req.user.userId]);
  if (!found.rows.length) return res.status(403).json({ message:'Only your completed orders can be reviewed' });
  const order=found.rows[0];
  try {
    const created=await pool.query(`INSERT INTO reviews
      (customer_id,business_id,listing_id,order_id,rating,comment,business_name,item_name,author_name)
      SELECT $1,$2,$3,$4,$5,$6,b.business_name,l.title,u.name
      FROM businesses b JOIN listings l ON l.business_id=b.user_id JOIN users u ON u.id=$1
      WHERE b.user_id=$2 AND l.id=$3 RETURNING id`,
      [req.user.userId,order.business_id,order.listing_id,orderId,rating,comment]);
    const result=await pool.query(`${reviewSql} WHERE r.id=$1`,[created.rows[0].id]);
    res.status(201).json({ review:result.rows[0] });
  } catch(error) {
    if (error.code==='23505') return res.status(409).json({ message:'This order already has a review' });
    throw error;
  }
}));
app.put('/api/reviews/:id', auth, role('customer'), wrap(async (req,res) => {
  const rating=Number(req.body.rating),comment=clean(req.body.comment,5000);
  if (!validId(req.params.id)||!Number.isInteger(rating)||rating<1||rating>5||!comment)
    return res.status(400).json({ message:'Enter a 1–5 rating and comment' });
  const updated=await pool.query('UPDATE reviews SET rating=$1,comment=$2 WHERE id=$3 AND customer_id=$4 RETURNING id',
    [rating,comment,req.params.id,req.user.userId]);
  if (!updated.rows.length) return res.status(404).json({ message:'Review not found' });
  const result=await pool.query(`${reviewSql} WHERE r.id=$1`,[req.params.id]);
  res.json({ review:result.rows[0] });
}));
app.patch('/api/reviews/:id/reply', auth, role('business'), wrap(async (req,res) => {
  const reply=clean(req.body.reply,5000);
  if (!validId(req.params.id)||!reply) return res.status(400).json({ message:'Reply is required' });
  const updated=await pool.query('UPDATE reviews SET reply=$1 WHERE id=$2 AND business_id=$3 RETURNING id',
    [reply,req.params.id,req.user.userId]);
  if (!updated.rows.length) return res.status(404).json({ message:'Review not found' });
  const result=await pool.query(`${reviewSql} WHERE r.id=$1`,[req.params.id]);
  res.json({ review:result.rows[0] });
}));
app.delete('/api/reviews/:id', auth, role('customer'), wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid review ID' });
  const result=await pool.query('DELETE FROM reviews WHERE id=$1 AND customer_id=$2 RETURNING id',
    [req.params.id,req.user.userId]);
  if (!result.rows.length) return res.status(404).json({ message:'Review not found' });
  res.json({ message:'Review deleted',id:result.rows[0].id });
}));

app.get('/api/business/analytics', auth, role('business'), wrap(async (req,res) => {
  const [summary,sales]=await Promise.all([
    pool.query(`SELECT (SELECT COUNT(*)::int FROM (${listingSql}) items WHERE business_id=$1
        AND is_active=TRUE AND daily_status='Active') AS active_listings,
      (SELECT COALESCE(SUM(quantity_sold),0)::int FROM sales_data WHERE business_id=$1) AS meals_rescued,
      (SELECT COALESCE(SUM(price),0)::numeric FROM sales_data WHERE business_id=$1) AS revenue`,[req.user.userId]),
    pool.query(`SELECT s.id,s.listing_id,l.title,s.quantity_sold,s.price,s.sale_time FROM sales_data s
      JOIN listings l ON l.id=s.listing_id WHERE s.business_id=$1 ORDER BY s.sale_time DESC LIMIT 50`,[req.user.userId])
  ]);
  res.json({ summary:summary.rows[0],sales:sales.rows });
}));
app.get('/api/business/predictions', auth, role('business'), wrap(async (req,res) => {
  const result=await pool.query('SELECT * FROM ml_predictions WHERE business_id=$1 ORDER BY prediction_date DESC',[req.user.userId]);
  res.json(result.rows);
}));

app.use('/api',(_,res)=>res.status(404).json({
  message:'This API route is not available. Restart the PlateUp backend if you recently updated the project.'
}));
app.use((error,req,res,next) => {
  const status=error instanceof multer.MulterError || error.status===400 ||
    ['23503','23514','22P02'].includes(error.code) ? 400 : error.status || 500;
  if (status>=500) console.error(error);
  const message=error instanceof multer.MulterError && error.code==='LIMIT_FILE_SIZE'
    ? 'Image must be 5 MB or smaller.' : error.status===400 ? error.message : 'Request could not be completed';
  res.status(status).json({ message });
});
if (require.main===module) {
  const port=process.env.PORT||5000;
  const server=app.listen(port,()=>console.log(`PlateUp server running on http://localhost:${port}`));
  server.on('error',error=>{
    console.error(error.code==='EADDRINUSE'
      ? `Port ${port} is already in use. This copy of PlateUp did not start. Stop the existing backend with Ctrl+C in its terminal, then run npm start again.`
      : 'PlateUp could not start: '+error.message);
    pool.end().finally(()=>{ process.exitCode=1; });
  });
}
module.exports=app;
