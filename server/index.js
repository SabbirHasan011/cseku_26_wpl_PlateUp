const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const pool = require('./db');
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
const listingSql = `WITH clock AS (SELECT CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka' AS local_now)
  SELECT l.id,l.title,l.description,l.category,l.business_id,l.original_price,l.rescue_price,
    l.image_path,l.offer_start_time,l.offer_end_time,l.is_active,l.created_at,l.updated_at,
    b.business_name,b.address AS pickup_address,b.city,
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
  FROM listings l JOIN businesses b ON b.user_id=l.business_id CROSS JOIN clock
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
    pool.query('SELECT role,status FROM users WHERE id=$1', [decoded.userId]).then(result => {
      if (!result.rows.length || result.rows[0].status !== 'active' || result.rows[0].role !== decoded.role)
        return res.status(401).json({ message: 'Account unavailable' });
      req.user = decoded;
      next();
    }).catch(next);
  }
  catch (_) { res.status(401).json({ message: 'Session expired or invalid' }); }
}
const role = name => (req, res, next) => req.user.role === name ? next()
  : res.status(403).json({ message: 'This account cannot perform that action' });

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
  const token = jwt.sign({ userId:user.id,email:user.email,role:user.role },process.env.JWT_SECRET,{ expiresIn:'1h' });
  res.json({ token,user:{ id:user.id,name:user.name,email:user.email,role:user.role } });
}));

app.get('/api/me', auth, wrap(async (req,res) => {
  const result = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.phone,u.status,u.created_at,
    c.address AS customer_address,c.city AS customer_city,c.preferred_location,
    b.business_name,b.description,b.address AS business_address,b.city AS business_city,
    b.phone AS business_phone,b.latitude,b.longitude,b.opening_time,b.closing_time
    FROM users u LEFT JOIN customers c ON c.user_id=u.id
    LEFT JOIN businesses b ON b.user_id=u.id WHERE u.id=$1 AND u.status='active'`,[req.user.userId]);
  if (!result.rows.length) return res.status(401).json({ message: 'Account unavailable' });
  res.json({ profile:result.rows[0] });
}));

app.put('/api/me', auth, wrap(async (req,res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('UPDATE users SET name=$1,phone=$2,updated_at=NOW() WHERE id=$3',
      [name,clean(req.body.phone,50)||null,req.user.userId]);
    if (req.user.role === 'customer') {
      await db.query('UPDATE customers SET address=$1,city=$2,preferred_location=$3 WHERE user_id=$4',
        [clean(req.body.address,2000)||null,clean(req.body.city)||null,clean(req.body.preferred_location)||null,req.user.userId]);
    } else if (req.user.role === 'business') {
      const latitude = req.body.latitude === '' || req.body.latitude == null ? null : Number(req.body.latitude);
      const longitude = req.body.longitude === '' || req.body.longitude == null ? null : Number(req.body.longitude);
      if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
        await db.query('ROLLBACK');
        return res.status(400).json({ message:'Invalid coordinates' });
      }
      await db.query(`UPDATE businesses SET business_name=$1,description=$2,address=$3,city=$4,
        phone=$5,opening_time=$6,closing_time=$7,latitude=$9,longitude=$10 WHERE user_id=$8`,
        [clean(req.body.business_name)||name,clean(req.body.description,2000)||null,
          clean(req.body.address,2000)||null,clean(req.body.city)||null,clean(req.body.phone,50)||null,
          req.body.opening_time||null,req.body.closing_time||null,req.user.userId,latitude,longitude]);
    }
    await db.query('COMMIT');
    res.json({ message:'Profile updated' });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));

app.get('/api/listings', wrap(async (_,res) => {
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE is_active=TRUE AND daily_status='Active' ORDER BY id DESC`);
  res.set('Cache-Control','no-store');
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
app.get('/api/listings/:id', wrap(async (req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message:'Invalid listing ID' });
  const result = await pool.query(`SELECT * FROM (${listingSql}) items
    WHERE id=$1 AND is_active=TRUE AND daily_status='Active'`,[req.params.id]);
  if (!result.rows.length) return res.status(404).json({ message:'Listing not found' });
  res.json({ listing:result.rows[0] });
}));

function listingInput(body) {
  const title = clean(body.title), category = clean(body.category,100);
  const original = Number(body.original_price), rescue = Number(body.rescue_price);
  const start = clean(body.offer_start_time,5), end = clean(body.offer_end_time,5);
  if (!title || !category || body.original_price==='' || body.rescue_price==='' ||
    !Number.isFinite(original) || original<0 ||
    !Number.isFinite(rescue) || rescue<0 || rescue>original ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end))
    return { error:'Enter a title, category, valid prices, and daily offer start/end times.' };
  return { values:[title,category,clean(body.description,2000)||null,original,rescue,start,end] };
}
app.post('/api/listings', auth, role('business'), imageUpload.single('image'), wrap(async (req,res) => {
  const parsed = listingInput(req.body);
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
  const parsed = listingInput(req.body);
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

app.post('/api/orders', auth, role('customer'), wrap(async (req,res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [{ listing_id:req.body.listing_id,quantity:req.body.quantity }];
  if (!items.length || items.length>30 || items.some(item=>!validId(item.listing_id)||!validId(item.quantity)))
    return res.status(400).json({ message:'Choose valid listings and positive quantities' });
  const combined = new Map();
  for (const item of items) combined.set(Number(item.listing_id),(combined.get(Number(item.listing_id))||0)+Number(item.quantity));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const orders=[];
    for (const [listingId,quantity] of [...combined].sort((a,b)=>a[0]-b[0])) {
      const stock = await db.query(`UPDATE daily_availability a SET
        remaining_quantity=a.remaining_quantity-$1,updated_at=NOW()
        FROM listings l WHERE a.listing_id=l.id AND l.id=$2 AND l.is_active=TRUE
        AND a.offer_date=CASE WHEN l.offer_end_time<l.offer_start_time AND
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::time<l.offer_end_time
          THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date-1
          ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date END
        AND a.remaining_quantity>=$1
        AND plateup_daily_status(a.offer_date,a.remaining_quantity,l.offer_start_time,
          l.offer_end_time,CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')='Active'
        RETURNING a.id,l.rescue_price`,[quantity,listingId]);
      if (!stock.rows.length) {
        await db.query('ROLLBACK');
        return res.status(409).json({ message:'An item is sold out or no longer available. Refresh and try again.' });
      }
      const total = Number(stock.rows[0].rescue_price)*quantity;
      const created = await db.query(`INSERT INTO orders
        (customer_id,listing_id,daily_availability_id,quantity,total_price,payment_method)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.userId,listingId,stock.rows[0].id,quantity,total,
          clean(req.body.payment_method,50)||'Pay at pickup']);
      orders.push(created.rows[0]);
    }
    await db.query('COMMIT');
    res.status(201).json({ orders });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}));
app.get('/api/orders', auth, wrap(async (req,res) => {
  const condition = req.user.role==='customer'?'o.customer_id=$1':'l.business_id=$1';
  const result = await pool.query(`${orderSql} WHERE ${condition} ORDER BY o.id DESC`,[req.user.userId]);
  res.json(result.rows);
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
    const next=req.body.status;
    const allowed=customer?['pending','confirmed'].includes(order.status)&&next==='cancelled'
      :({ pending:'confirmed',confirmed:'ready',ready:'completed' })[order.status]===next;
    if (!allowed) { await db.query('ROLLBACK'); return res.status(400).json({ message:'Invalid order status change' }); }
    const updated=await db.query(`UPDATE orders SET status=$1::varchar,updated_at=NOW(),
      payment_status=CASE WHEN $1::varchar='completed' AND payment_method='Pay at pickup' THEN 'paid'
      ELSE payment_status END WHERE id=$2 RETURNING *`,[next,order.id]);
    if (next==='cancelled' && order.daily_availability_id) await db.query(`UPDATE daily_availability
      SET remaining_quantity=remaining_quantity+$1,updated_at=NOW() WHERE id=$2`,
      [order.quantity,order.daily_availability_id]);
    if (next==='completed') await db.query(`INSERT INTO sales_data
      (business_id,listing_id,order_id,quantity_sold,price) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id) DO NOTHING`,
      [order.business_id,order.listing_id,order.id,order.quantity,order.total_price]);
    await db.query('COMMIT');
    res.json({ order:updated.rows[0] });
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
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

app.use((error,req,res,next) => {
  const status=error instanceof multer.MulterError || error.status===400 ||
    ['23503','23514','22P02'].includes(error.code) ? 400 : error.status || 500;
  if (status>=500) console.error(error);
  const message=error instanceof multer.MulterError && error.code==='LIMIT_FILE_SIZE'
    ? 'Image must be 5 MB or smaller.' : error.status===400 ? error.message : 'Request could not be completed';
  res.status(status).json({ message });
});
if (require.main===module) app.listen(process.env.PORT||5000,()=>
  console.log(`PlateUp server running on http://localhost:${process.env.PORT||5000}`));
module.exports=app;
