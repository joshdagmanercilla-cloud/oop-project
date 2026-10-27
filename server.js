const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@harborhouse.test').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'RoomService2026!';
const MAX_BODY = 5 * 1024 * 1024;
const brokenDemoDrinkImage = 'https://images.unsplash.com/photo-1513558161293-cdaf765edfd7?auto=format&fit=crop&w=900&q=85';
const replacementDemoDrinkImage = 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85';

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before starting in production.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'hotel.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});
const verifyPassword = (password, salt, hash) => crypto.timingSafeEqual(
  Buffer.from(hashPassword(password, salt).hash, 'hex'), Buffer.from(hash, 'hex'),
);
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const runTransaction = callback => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
};
const seedMenu = () => {
  if (db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count) return;
  const items = [
    ['Sunrise longganisa plate', 'Garlic rice, two sunny eggs, house-made pork longganisa and atchara.', 485, 'Breakfast', 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Pandan French toast', 'Brioche dipped in pandan custard, coconut cream and seasonal fruit.', 395, 'Breakfast', 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Garden greens & mango', 'Local greens, ripe mango, salted cashews and calamansi vinaigrette.', 445, 'Lunch', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Crispy pata bao', 'Slow-cooked pork, pickled papaya and chili-lime glaze in soft bao buns.', 625, 'Lunch', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=900&q=85', 1, 0],
    ['Pan-seared catch of the day', 'Fresh local fish, charred vegetables and ginger-calamansi butter.', 795, 'Dinner', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Wagyu tapa bowl', 'Tender beef tapa, garlic rice, atchara and a slow-cooked egg.', 735, 'Dinner', 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Truffle kesong puti fries', 'Golden fries, local white cheese, truffle oil and fresh herbs.', 365, 'Snacks', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Ube cheesecake', 'Silky ube cheesecake on a toasted coconut and biscuit base.', 325, 'Snacks', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=85', 1, 1],
    ['Calamansi spritz', 'Fresh calamansi, sparkling water, mint and a touch of honey.', 225, 'Drinks', replacementDemoDrinkImage, 1, 1],
    ['Kapeng barako', 'Locally roasted Batangas coffee, served hot with milk on the side.', 195, 'Drinks', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=85', 1, 1],
  ];
  const insert = db.prepare('INSERT INTO menu_items (name, description, price, category, image_url, available, featured) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of items) insert.run(...item);
};
seedMenu();
if (!db.prepare('SELECT id FROM admins WHERE email = ?').get(ADMIN_EMAIL)) {
  const { salt, hash } = hashPassword(ADMIN_PASSWORD);
  db.prepare('INSERT INTO admins (email, password_salt, password_hash, role) VALUES (?, ?, ?, ?)').run(ADMIN_EMAIL, salt, hash, 'admin');
}

const sessions = new Map();
const loginAttempts = new Map();
const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
const readBody = req => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY) { reject(Object.assign(new Error('Request is too large.'), { status: 413 })); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
  });
  req.on('error', reject);
});
const requireAdmin = (req, res) => {
  const token = getCookie(req, 'hotel_session');
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    json(res, 401, { error: 'Please sign in with an authorized staff account.' });
    return null;
  }
  session.expires = Date.now() + 8 * 60 * 60 * 1000;
  return session;
};
const validText = (value, max = 180) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const isoTimestamp = value => new Date(`${String(value).replace(' ', 'T')}Z`).toISOString();
const guestOrder = row => ({
  orderNumber: row.public_id,
  guestName: row.guest_name,
  roomNumber: row.room_number,
  total: row.total,
  paymentMethod: row.payment_method,
  status: row.status,
  createdAt: isoTimestamp(row.created_at),
  instructions: row.instructions,
  items: db.prepare('SELECT name, quantity, unit_price AS unitPrice, line_total AS lineTotal FROM order_items WHERE order_id = ?').all(row.id),
});
const orderStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready for Delivery', 'Out for Delivery', 'Delivered', 'Cancelled'];
const allowedTransitions = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready for Delivery', 'Cancelled'],
  'Ready for Delivery': ['Out for Delivery', 'Cancelled'],
  'Out for Delivery': ['Delivered'],
  Delivered: [],
  Cancelled: [],
};

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true });
  if (pathname === '/api/menu' && req.method === 'GET') {
    const items = db.prepare('SELECT id, name, description, price, category, image_url AS imageUrl, available, featured FROM menu_items ORDER BY featured DESC, id').all();
    return json(res, 200, items.map(item => item.imageUrl === brokenDemoDrinkImage ? { ...item, imageUrl: replacementDemoDrinkImage } : item));
  }
  if (pathname === '/api/orders' && req.method === 'POST') {
    const body = await readBody(req);
    const { guestName, roomNumber, contactNumber, paymentMethod, instructions = '', items } = body;
    if (!validText(guestName, 100) || !validText(roomNumber, 20) || !validText(contactNumber, 30)) return json(res, 400, { error: 'Enter your name, room number and contact number.' });
    if (!['Cash to room', 'Cash at counter', 'GCash'].includes(paymentMethod)) return json(res, 400, { error: 'Choose a valid payment method.' });
    if (!Array.isArray(items) || items.length < 1 || items.length > 40) return json(res, 400, { error: 'Add at least one menu item before checkout.' });
    if (typeof instructions !== 'string' || instructions.length > 500) return json(res, 400, { error: 'Special requests must be 500 characters or fewer.' });
    const quantities = new Map();
    for (const item of items) {
      if (!Number.isSafeInteger(Number(item.id)) || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 20) return json(res, 400, { error: 'One or more item quantities are invalid.' });
      quantities.set(Number(item.id), (quantities.get(Number(item.id)) || 0) + Number(item.quantity));
    }
    if ([...quantities.values()].some(quantity => quantity > 20)) return json(res, 400, { error: 'Maximum quantity per item is 20.' });
    const createOrder = () => runTransaction(() => {
      const products = [];
      for (const [id, quantity] of quantities) {
        const product = db.prepare('SELECT id, name, price, available FROM menu_items WHERE id = ?').get(id);
        if (!product || !product.available) throw new Error('One or more selected items are currently unavailable. Refresh the menu and try again.');
        products.push({ ...product, quantity });
      }
      const total = products.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (!Number.isSafeInteger(total) || total < 1) throw new Error('Unable to calculate this order total.');
      const publicId = `HH-${new Date().getFullYear()}-${randomToken(4).toUpperCase()}`;
      const accessToken = randomToken();
      const result = db.prepare('INSERT INTO orders (public_id, access_token_hash, guest_name, room_number, contact_number, payment_method, instructions, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(publicId, crypto.createHash('sha256').update(accessToken).digest('hex'), guestName.trim(), roomNumber.trim(), contactNumber.trim(), paymentMethod, instructions.trim(), total, 'Pending');
      for (const item of products) db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)').run(result.lastInsertRowid, item.id, item.name, item.quantity, item.price, item.price * item.quantity);
      db.prepare('INSERT INTO order_status_history (order_id, status, changed_by) VALUES (?, ?, ?)').run(result.lastInsertRowid, 'Pending', 'Guest');
      db.prepare('INSERT INTO payment_records (order_id, method, amount, status) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, paymentMethod, total, 'Pending');
      return { orderNumber: publicId, accessToken, guestName: guestName.trim(), roomNumber: roomNumber.trim(), total, paymentMethod, status: 'Pending', instructions: instructions.trim(), items: products.map(item => ({ name: item.name, quantity: item.quantity, unitPrice: item.price, lineTotal: item.price * item.quantity })), createdAt: new Date().toISOString() };
    });
    try { return json(res, 201, createOrder()); }
    catch (error) { return json(res, 400, { error: error.message || 'Your order could not be saved.' }); }
  }
  if (pathname.startsWith('/api/orders/') && req.method === 'GET') {
    const publicId = decodeURIComponent(pathname.slice('/api/orders/'.length));
    const accessToken = url.searchParams.get('token') || '';
    if (!/^[A-Z0-9-]{8,40}$/.test(publicId) || !/^[a-f0-9]{64}$/.test(accessToken)) return json(res, 404, { error: 'Order not found.' });
    const row = db.prepare('SELECT * FROM orders WHERE public_id = ? AND access_token_hash = ?').get(publicId, crypto.createHash('sha256').update(accessToken).digest('hex'));
    return row ? json(res, 200, guestOrder(row)) : json(res, 404, { error: 'Order not found. This order may belong to a different device.' });
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempts = (loginAttempts.get(ip) || []).filter(time => time > Date.now() - 15 * 60 * 1000);
    if (attempts.length >= 8) return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    const body = await readBody(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || email.length > 254 || password.length > 256) return json(res, 400, { error: 'Enter a valid work email and password.' });
    const admin = db.prepare('SELECT id, email, password_salt, password_hash, role FROM admins WHERE email = ? AND active = 1').get(email);
    if (!admin || !verifyPassword(password, admin.password_salt, admin.password_hash)) {
      attempts.push(Date.now()); loginAttempts.set(ip, attempts);
      return json(res, 401, { error: 'Email or password is incorrect.' });
    }
    loginAttempts.delete(ip);
    const token = randomToken();
    sessions.set(token, { adminId: admin.id, email: admin.email, role: admin.role, expires: Date.now() + 8 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `hotel_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return json(res, 200, { email: admin.email, role: admin.role });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const token = getCookie(req, 'hotel_session');
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'hotel_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/me' && req.method === 'GET') {
    const session = requireAdmin(req, res);
    return session ? json(res, 200, { email: session.email, role: session.role }) : undefined;
  }
  if (pathname.startsWith('/api/admin/')) {
    const session = requireAdmin(req, res);
    if (!session) return;
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const status = url.searchParams.get('status') || '';
      const search = (url.searchParams.get('search') || '').trim().slice(0, 100);
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const clauses = [];
      const params = [];
      if (orderStatuses.includes(status)) { clauses.push('o.status = ?'); params.push(status); }
      if (search) { clauses.push('(o.public_id LIKE ? OR o.guest_name LIKE ? OR o.room_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push("date(o.created_at, '+8 hours') >= date(?)"); params.push(from); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push("date(o.created_at, '+8 hours') <= date(?)"); params.push(to); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const orders = db.prepare(`SELECT o.*, GROUP_CONCAT(oi.name || ' × ' || oi.quantity, ', ') AS item_summary FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT 250`).all(...params);
      return json(res, 200, orders.map(o => ({ orderNumber: o.public_id, guestName: o.guest_name, roomNumber: o.room_number, contactNumber: o.contact_number, items: o.item_summary, total: o.total, paymentMethod: o.payment_method, status: o.status, createdAt: isoTimestamp(o.created_at), instructions: o.instructions })));
    }
    const orderMatch = pathname.match(/^\/api\/admin\/orders\/([A-Z0-9-]+)$/);
    if (orderMatch && req.method === 'GET') {
      const row = db.prepare('SELECT * FROM orders WHERE public_id = ?').get(orderMatch[1]);
      return row ? json(res, 200, guestOrder(row)) : json(res, 404, { error: 'Order not found.' });
    }
    if (orderMatch && req.method === 'PATCH') {
      const body = await readBody(req);
      if (!orderStatuses.includes(body.status)) return json(res, 400, { error: 'Choose a valid order status.' });
      const update = () => runTransaction(() => {
        const row = db.prepare('SELECT id, status FROM orders WHERE public_id = ?').get(orderMatch[1]);
        if (!row) return false;
        if (row.status === body.status) return true;
        if (!allowedTransitions[row.status].includes(body.status)) {
          throw Object.assign(new Error(`An order cannot move from ${row.status} to ${body.status}.`), { status: 409 });
        }
        db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(body.status, row.id);
        if (row.status !== body.status) db.prepare('INSERT INTO order_status_history (order_id, status, changed_by) VALUES (?, ?, ?)').run(row.id, body.status, session.email);
        return true;
      });
      return update() ? json(res, 200, { ok: true, status: body.status }) : json(res, 404, { error: 'Order not found.' });
    }
    if (pathname === '/api/admin/menu' && req.method === 'POST') {
      const body = await readBody(req);
      if (!validText(body.name, 100) || !validText(body.description, 500) || !Number.isSafeInteger(Number(body.price)) || Number(body.price) < 1 || Number(body.price) > 100000 || !['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'].includes(body.category)) return json(res, 400, { error: 'Check the item name, description, category and whole-peso price.' });
      const result = db.prepare('INSERT INTO menu_items (name, description, price, category, image_url, available, featured) VALUES (?, ?, ?, ?, ?, ?, ?)').run(body.name.trim(), body.description.trim(), Number(body.price), body.category, typeof body.imageUrl === 'string' ? body.imageUrl.slice(0, 500) : '', body.available === false ? 0 : 1, body.featured ? 1 : 0);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const menuMatch = pathname.match(/^\/api\/admin\/menu\/(\d+)$/);
    if (menuMatch && req.method === 'PATCH') {
      const body = await readBody(req);
      const current = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(menuMatch[1]));
      if (!current) return json(res, 404, { error: 'Menu item not found.' });
      const name = body.name ?? current.name;
      const description = body.description ?? current.description;
      const price = body.price === undefined ? current.price : Number(body.price);
      const category = body.category ?? current.category;
      if (!validText(name, 100) || !validText(description, 500) || !Number.isSafeInteger(price) || price < 1 || price > 100000 || !['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'].includes(category)) return json(res, 400, { error: 'Check the item name, description, category and whole-peso price.' });
      db.prepare('UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, image_url = ?, available = ?, featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), description.trim(), price, category, body.imageUrl ?? current.image_url, body.available === undefined ? current.available : (body.available ? 1 : 0), body.featured === undefined ? current.featured : (body.featured ? 1 : 0), current.id);
      return json(res, 200, { ok: true });
    }
    if (menuMatch && req.method === 'DELETE') {
      db.prepare('DELETE FROM menu_items WHERE id = ?').run(Number(menuMatch[1]));
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/upload' && req.method === 'POST') {
      const body = await readBody(req);
      const match = typeof body.data === 'string' && body.data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(res, 400, { error: 'Choose a JPG, PNG or WebP image.' });
      const image = Buffer.from(match[2], 'base64');
      if (!image.length || image.length > 3 * 1024 * 1024) return json(res, 400, { error: 'Images must be smaller than 3 MB.' });
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
      const filename = `${randomToken(16)}.${extension}`;
      fs.writeFileSync(path.join(UPLOADS, filename), image, { flag: 'wx' });
      return json(res, 201, { imageUrl: `/uploads/${filename}` });
    }
    if (pathname === '/api/admin/summary' && req.method === 'GET') {
      const totals = db.prepare("SELECT COUNT(*) AS total_orders, SUM(status = 'Pending') AS pending_orders, SUM(status = 'Delivered') AS completed_orders, COALESCE(SUM(CASE WHEN status = 'Delivered' THEN total ELSE 0 END), 0) AS total_sales FROM orders").get();
      const sales = db.prepare("SELECT date(created_at, '+8 hours') AS day, SUM(total) AS total, COUNT(*) AS orders FROM orders WHERE status = 'Delivered' AND date(created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') GROUP BY date(created_at, '+8 hours') ORDER BY day").all();
      const sales30 = db.prepare("SELECT date(created_at, '+8 hours') AS day, SUM(total) AS total, COUNT(*) AS orders FROM orders WHERE status = 'Delivered' AND date(created_at, '+8 hours') >= date('now', '+8 hours', '-29 days') GROUP BY date(created_at, '+8 hours') ORDER BY day").all();
      const bestSellers = db.prepare("SELECT oi.name, SUM(oi.quantity) AS quantity FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'Delivered' GROUP BY oi.name ORDER BY quantity DESC LIMIT 5").all();
      const statusCounts = db.prepare('SELECT status, COUNT(*) AS count FROM orders GROUP BY status').all();
      const guests = db.prepare('SELECT guest_name AS name, room_number AS roomNumber, contact_number AS contactNumber, COUNT(*) AS orderCount, MAX(created_at) AS lastOrder FROM orders GROUP BY guest_name, room_number, contact_number ORDER BY lastOrder DESC LIMIT 100').all();
      return json(res, 200, { totalOrders: totals.total_orders || 0, pendingOrders: totals.pending_orders || 0, completedOrders: totals.completed_orders || 0, totalSales: totals.total_sales || 0, sales, sales30, statusCounts, bestSellers, guests: guests.map(guest => ({ ...guest, lastOrder: isoTimestamp(guest.lastOrder) })) });
    }
  }
  return json(res, 404, { error: 'Not found.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    
    let requestedPath = decodeURIComponent(url.pathname);
    if (requestedPath === '/') requestedPath = '/index.html';
    
    // Direktang kunin ang safe path mula sa public directory gamit ang path.join
    let filepath = path.join(PUBLIC, requestedPath);

    // Siguraduhing ligtas at nasa loob ng public folder ang path (iwas directory traversal attack)
    if (!filepath.startsWith(PUBLIC)) {
      return json(res, 403, { error: 'Forbidden.' });
    }
    
    if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
      // Kung HTML navigation request at hindi nahanap, ibigay ang index.html para sa SPA routing
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        filepath = path.join(PUBLIC, 'index.html');
      } else {
        return json(res, 404, { error: 'Not found.' });
      }
    }

    const ext = path.extname(filepath);
    const isServiceWorker = requestedPath === '/sw.js';

    res.writeHead(200, { 
      'Content-Type': mimeTypes[ext] || 'application/octet-stream', 
      'X-Content-Type-Options': 'nosniff', 
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // Huwag i-cache ang Service Worker para laging bagong bersyon ang makuha ng PWA
      'Cache-Control': isServiceWorker ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
    });
    fs.createReadStream(filepath).pipe(res);
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    if (!error.status) console.error(error);
  }
});

server.listen(PORT, () => {
  console.log(`Harbor House ordering system: http://localhost:${PORT}`);
  console.log(`Local staff login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  if (process.env.NODE_ENV !== 'production') console.warn('Demo credentials are enabled. Set ADMIN_EMAIL and ADMIN_PASSWORD before deployment.');
});
