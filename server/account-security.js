const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { createPasswordResetSender } = require('./mail');
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const validPassword = value => typeof value==='string' && value.length>=8 && Buffer.byteLength(value,'utf8')<=72;

function registerAccountSecurity(app,{auth,wrap}) {
  app.locals.passwordResetSender=createPasswordResetSender();
  const attempts=new Map();
  function limit(req,res,next) {
    const now=Date.now(), key=req.ip+req.path;
    for (const [id,entry] of attempts) if (entry.until<=now) attempts.delete(id);
    const entry=attempts.get(key)||{ count:0,until:now+15*60000 };
    if (++entry.count>10 || attempts.size>10000) return res.status(429).json({message:'Too many attempts. Try again in 15 minutes.'});
    attempts.set(key,entry); next();
  }
  async function changePassword(db,userId,passwordHash) {
    await db.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1,updated_at=NOW() WHERE id=$2',[passwordHash,userId]);
    await db.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[userId]);
  }
  app.post('/api/auth/change-password',auth,limit,wrap(async(req,res)=>{
    if (typeof req.body.current_password!=='string' || !validPassword(req.body.new_password))
      return res.status(400).json({message:'Enter your current password and a new password of 8–72 UTF-8 bytes.'});
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const user=(await db.query('SELECT password_hash,auth_version FROM users WHERE id=$1 FOR UPDATE',[req.user.userId])).rows[0];
      if (user.auth_version!==(req.user.version||0) || !await bcrypt.compare(req.body.current_password,user.password_hash)) {
        await db.query('ROLLBACK'); return res.status(400).json({message:'Current password is incorrect or your session has expired.'});
      }
      await changePassword(db,req.user.userId,await bcrypt.hash(req.body.new_password,10));
      await db.query('COMMIT');
      res.json({message:'Password changed. Sign in again with your new password.'});
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }));
  app.post('/api/auth/forgot-password',limit,wrap(async(req,res)=>{
    if (!app.locals.passwordResetSender) return res.status(503).json({message:'Email recovery is not configured yet. Contact the platform administrator.'});
    const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length>255) return res.status(400).json({message:'Enter a valid email address.'});
    const db=await pool.connect();
    let delivery=null;
    try {
      await db.query('BEGIN');
      const user=(await db.query("SELECT id,email FROM users WHERE email=$1 AND status='active' FOR UPDATE",[email])).rows[0];
      if (user) {
        const recent=await db.query("SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute'",[user.id]);
        if (!recent.rows.length) {
          const token=crypto.randomBytes(32).toString('hex');
          await db.query('DELETE FROM password_resets WHERE user_id=$1',[user.id]);
          await db.query("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '30 minutes')",[hashToken(token),user.id]);
          delivery={ email:user.email,token };
        }
      }
      await db.query('COMMIT');
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
    if (delivery) {
      try { await app.locals.passwordResetSender(delivery); }
      catch(_) {
        await pool.query('DELETE FROM password_resets WHERE token_hash=$1',[hashToken(delivery.token)]);
        console.error('Password reset email delivery failed. Check SMTP configuration.');
      }
    }
    res.status(202).json({message:'If an active account matches that email, a password-reset link will be sent. Check your inbox and spam folder.'});
  }));
  app.post('/api/auth/reset-password',limit,wrap(async(req,res)=>{
    if (typeof req.body.token!=='string' || !/^[a-f0-9]{64}$/.test(req.body.token) || !validPassword(req.body.new_password))
      return res.status(400).json({message:'Use a valid reset link and a password of 8–72 UTF-8 bytes.'});
    const hash=hashToken(req.body.token), db=await pool.connect();
    try {
      await db.query('BEGIN');
      // Lock the user first, as change-password and reset requests do, to serialize consumption.
      const user=(await db.query(`SELECT u.id FROM users u JOIN password_resets r ON r.user_id=u.id
        WHERE r.token_hash=$1 AND u.status='active' FOR UPDATE OF u`,[hash])).rows[0];
      const reset=user && (await db.query('SELECT user_id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',[hash])).rows[0];
      if (!reset) { await db.query('ROLLBACK'); return res.status(400).json({message:'This reset link has expired or has already been used. Request a new one.'}); }
      await changePassword(db,user.id,await bcrypt.hash(req.body.new_password,10));
      await db.query('COMMIT');
      res.json({message:'Password reset. Sign in with your new password.'});
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }));
}
module.exports={registerAccountSecurity};
