const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const exists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, passwordHash, role || 'customer']
    );

    return res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Signup failed', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Email, password, and role are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, role]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '1h' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

app.get('/api/listings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM listings ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listings', error: error.message });
  }
});

app.post('/api/listings', async (req, res) => {
  const { title, category, business_name, original_price, rescue_price, quantity } = req.body;

  if (!title || !category) {
    return res.status(400).json({ message: 'Title and category are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO listings (title, category, business_name, original_price, rescue_price, quantity) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, category, business_name || 'Local Business', original_price || 0, rescue_price || 0, quantity || 1]
    );
    res.status(201).json({ listing: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create listing', error: error.message });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reviews ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch reviews', error: error.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  const { business_name, item_name, author_name, rating, comment } = req.body;

  if (!business_name || !item_name || !comment) {
    return res.status(400).json({ message: 'Business, item, and comment are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO reviews (business_name, item_name, author_name, rating, comment) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [business_name, item_name, author_name || 'Verified Customer', rating || 5, comment]
    );
    res.status(201).json({ review: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create review', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`PlateUp server running on http://localhost:${PORT}`);
});
