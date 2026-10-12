const bcrypt = require('bcrypt');
const pool = require('../server/db');

async function createAdmin({ email, name, password }) {
  if (typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>255||
    typeof name!=='string'||!name.trim()||name.trim().length>255||typeof password!=='string'||
    password.length<8||Buffer.byteLength(password,'utf8')>72) throw new Error('Provide a valid email, name and password of 8–72 UTF-8 bytes.');
  const hash=await bcrypt.hash(password,10);
  try {
    return (await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,'admin')
      RETURNING id,name,email,role`,[name.trim(),email.trim().toLowerCase(),hash])).rows[0];
  } catch(error) {
    if(error.code==='23505') throw new Error('That email already exists. Existing accounts are never promoted or overwritten.');
    throw error;
  }
}

if(require.main===module) {
  const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
  const password=process.env.PLATEUP_ADMIN_PASSWORD;
  delete process.env.PLATEUP_ADMIN_PASSWORD;
  createAdmin({email:args.includes('--email')?value('--email'):null,
    name:args.includes('--name')?value('--name'):'PlateUp administrator',password})
    .then(user=>console.log('Created administrator '+user.email+'. Sign in at /admin/login.'))
    .catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
}
module.exports={createAdmin};
