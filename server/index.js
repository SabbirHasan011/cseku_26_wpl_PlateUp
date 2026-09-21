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

function parseListingInput(body) {
  const { title, category, business_name, original_price, rescue_price, quantity } = body;
  const originalPrice = Number(original_price);
  const rescuePrice = Number(rescue_price);
  const listingQuantity = Number(quantity);

  if (!title || !category) return { error: 'Title and category are required' };
  if (!Number.isFinite(originalPrice) || originalPrice < 0) return { error: 'Original price must be a non-negative number' };
  if (!Number.isFinite(rescuePrice) || rescuePrice < 0) return { error: 'Rescue price must be a non-negative number' };
  if (rescuePrice > originalPrice) return { error: 'Rescue price cannot be greater than original price' };
  if (!Number.isInteger(listingQuantity) || listingQuantity < 1) return { error: 'Quantity must be a positive whole number' };

  return {
    values: [title.trim(), category.trim(), business_name?.trim() || 'Local Business', originalPrice, rescuePrice, listingQuantity]
  };
}

app.get('/api/listings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM listings ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listings', error: error.message });
  }
});

app.get('/api/listings/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    res.json({ listing: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listing', error: error.message });
  }
});

app.post('/api/listings', async (req, res) => {
  const parsed = parseListingInput(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  try {
    const result = await pool.query(
      'INSERT INTO listings (title, category, business_name, original_price, rescue_price, quantity) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      parsed.values
    );
    res.status(201).json({ listing: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create listing', error: error.message });
  }
});

app.put('/api/listings/:id', async (req, res) => {
  const parsed = parseListingInput(req.body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  try {
    const result = await pool.query(
      'UPDATE listings SET title = $1, category = $2, business_name = $3, original_price = $4, rescue_price = $5, quantity = $6 WHERE id = $7 RETURNING *',
      [...parsed.values, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    res.json({ listing: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update listing', error: error.message });
  }
});

app.delete('/api/listings/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM listings WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    res.json({ message: 'Listing deleted', id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete listing', error: error.message });
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

app.get('/api/reviews/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Review not found' });
    res.json({ review: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch review', error: error.message });
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

app.put('/api/reviews/:id', async (req, res) => {
  const { business_name, item_name, author_name, rating, comment, reply } = req.body;
  const reviewRating = Number(rating);
  if (!business_name || !item_name || !comment) return res.status(400).json({ message: 'Business, item, and comment are required' });
  if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5) return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5' });

  try {
    const result = await pool.query(
      'UPDATE reviews SET business_name = $1, item_name = $2, author_name = $3, rating = $4, comment = $5, reply = $6 WHERE id = $7 RETURNING *',
      [business_name.trim(), item_name.trim(), author_name?.trim() || 'Verified Customer', reviewRating, comment.trim(), reply?.trim() || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Review not found' });
    res.json({ review: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update review', error: error.message });
  }
});

app.delete('/api/reviews/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM reviews WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Review not found' });
    res.json({ message: 'Review deleted', id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete review', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`PlateUp server running on http://localhost:${PORT}`);
});
