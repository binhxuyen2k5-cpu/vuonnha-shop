require('dotenv').config();
const express = require('express'), path = require('path'), fs = require('fs'), crypto = require('crypto'), mysql = require('mysql2/promise'),
  bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), multer = require('multer'), nodemailer = require('nodemailer');
const E = process.env, SECRET = E.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('✖ Hãy đặt JWT_SECRET (>= 16 ký tự) trong file .env'); process.exit(1); }

const db = mysql.createPool({ host: E.DB_HOST || 'localhost', user: E.DB_USER || 'root', password: E.DB_PASSWORD || '',
  database: E.DB_NAME || 'vuonnha', charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10 });
const STATUS = ['Chờ xác nhận', 'Đang giao', 'Hoàn thành', 'Đã hủy'];
const BASE = (E.BASE_URL || `http://localhost:${E.PORT || 3000}`).replace(/\/$/, '');
const PAY_TIMEOUT = E.PAY_TIMEOUT_MIN === undefined || E.PAY_TIMEOUT_MIN === '' ? 60 : +E.PAY_TIMEOUT_MIN;

// ----- Upload ảnh -----
const UP = path.join(__dirname, 'uploads'); fs.mkdirSync(UP, { recursive: true });
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + EXT[f.mimetype]) }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (q, f, cb) => EXT[f.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Chỉ nhận ảnh JPG/PNG/WEBP/GIF'), { status: 400 }))
});

// ----- Email -----
const mailer = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port: +E.SMTP_PORT || 587, secure: +E.SMTP_PORT === 465,
  auth: E.SMTP_USER ? { user: E.SMTP_USER, pass: E.SMTP_PASS } : undefined }) : null;
async function sendMail(to, subject, html, text) {
  if (!mailer) { console.log(`\n[MAIL - chưa cấu hình SMTP] Tới: ${to}\n${subject}\n${text}\n`); return; }
  await mailer.sendMail({ from: E.MAIL_FROM || E.SMTP_USER, to, subject, html, text });
}

// ----- Tiện ích -----
const app = express(); app.use(express.json());
const h = f => (q, s, n) => f(q, s, n).catch(n);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const sha = x => crypto.createHash('sha256').update(String(x)).digest('hex');
const same = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function tx(fn) {
  const c = await db.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
const restock = (c, orderId) => c.query('UPDATE products p JOIN order_items i ON i.product_id=p.id SET p.stock=p.stock+i.qty WHERE i.order_id=?', [orderId]);
const auth = role => (q, s, n) => {
  try { q.user = jwt.verify((q.headers.authorization || '').slice(7), SECRET); } catch { return s.status(401).json({ error: 'Vui lòng đăng nhập' }); }
  if (role && q.user.role !== role) return s.status(403).json({ error: 'Không có quyền truy cập' });
  n();
};
const sign = u => ({ token: jwt.sign({ id: u.id, name: u.name, role: u.role }, SECRET, { expiresIn: '7d' }), user: { id: u.id, name: u.name, role: u.role } });
const tries = new Map(); // giới hạn: 10 lần / 15 phút / IP / đường dẫn
const limit = (q, s, n) => { const k = q.ip + q.path, t = Date.now(), a = (tries.get(k) || []).filter(x => t - x < 9e5);
  if (a.length >= 10) return s.status(429).json({ error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' }); a.push(t); tries.set(k, a); n(); };
const ORDER_COLS = 'id,name,phone,address AS addr,pay,total,status,payment_status AS pay_status,created_at AS date';
async function withItems(os) {
  if (!os.length) return os;
  const [it] = await db.query('SELECT order_id,name,price,qty FROM order_items WHERE order_id IN (?)', [os.map(o => o.id)]);
  return os.map(o => ({ ...o, items: it.filter(i => i.order_id === o.id) }));
}

// ----- Cấu hình công khai -----
app.get('/api/config', (q, s) => s.json({
  shop: { addr: E.SHOP_ADDR, phone: E.SHOP_PHONE, email: E.SHOP_EMAIL, hours: E.SHOP_HOURS },
  bank: { id: E.BANK_ID, no: E.BANK_NO, name: E.BANK_NAME }
}));

// ----- Tài khoản -----
app.post('/api/auth/register', h(async (q, s) => {
  const { name, email, password } = q.body, em = String(email || '').trim().toLowerCase();
  if (!String(name || '').trim() || !/^\S+@\S+\.\S+$/.test(em) || String(password || '').length < 6) throw bad('Họ tên, email hợp lệ và mật khẩu ≥ 6 ký tự là bắt buộc');
  try {
    const [r] = await db.query("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'user')", [name.trim(), em, await bcrypt.hash(password, 10)]);
    s.json(sign({ id: r.insertId, name: name.trim(), role: 'user' }));
  } catch (x) { throw x.code === 'ER_DUP_ENTRY' ? bad('Email đã tồn tại', 409) : x; }
}));
app.post('/api/auth/login', limit, h(async (q, s) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE email=?', [String(q.body.email || '').trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(String(q.body.password || ''), u.password_hash))) throw bad('Sai email hoặc mật khẩu', 401);
  s.json(sign(u));
}));

// Quên mật khẩu: luôn trả cùng một thông báo để không lộ email nào đã đăng ký
app.post('/api/auth/forgot', limit, h(async (q, s) => {
  const msg = { ok: true, message: 'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu. Vui lòng kiểm tra hộp thư (cả mục Spam).' };
  const em = String(q.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(em)) return s.json(msg);
  const [[u]] = await db.query('SELECT id,name FROM users WHERE email=?', [em]);
  if (u) {
    const raw = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<NOW()', [u.id]);
    await db.query('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,NOW() + INTERVAL 30 MINUTE)', [u.id, sha(raw)]);
    const link = `${BASE}/reset.html?token=${raw}`;
    sendMail(em, 'Đặt lại mật khẩu - Vườn Nhà',
      `<p>Xin chào ${escH(u.name)},</p><p>Bạn vừa yêu cầu đặt lại mật khẩu. Bấm vào liên kết dưới đây (hiệu lực 30 phút):</p><p><a href="${link}">${link}</a></p><p>Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>`,
      `Xin chào ${u.name},\nĐặt lại mật khẩu (hiệu lực 30 phút): ${link}\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`
    ).catch(x => console.error('✖ Gửi email lỗi:', x.message)); // không await: tránh lộ email tồn tại qua thời gian phản hồi
  }
  s.json(msg);
}));
app.post('/api/auth/reset', limit, h(async (q, s) => {
  const { token, password } = q.body;
  if (String(password || '').length < 6) throw bad('Mật khẩu tối thiểu 6 ký tự');
  await tx(async c => {
    const [[r]] = await c.query('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>NOW() FOR UPDATE', [sha(token || '')]);
    if (!r) throw bad('Liên kết không hợp lệ hoặc đã hết hạn');
    await c.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(password, 10), r.user_id]);
    await c.query('DELETE FROM password_resets WHERE user_id=?', [r.user_id]);
  });
  s.json({ ok: true });
}));

// ----- Danh mục & sản phẩm (công khai) -----
app.get('/api/categories', h(async (q, s) => s.json((await db.query('SELECT id,name FROM categories ORDER BY id'))[0])));

const PCOLS = 'p.id,p.name,p.price,p.old_price AS old,p.category_id AS cat,p.img,p.description,p.stock';
app.get('/api/products', h(async (q, s) => {
  const per = Math.min(Math.max(+q.query.per || 8, 1), 50), w = [], a = [];
  if (q.query.q) { w.push('p.name LIKE ?'); a.push('%' + q.query.q + '%'); }
  if (+q.query.cat) { w.push('p.category_id=?'); a.push(+q.query.cat); }
  if (q.query.ids) {
    const ids = String(q.query.ids).split(',').map(Number).filter(Boolean);
    if (!ids.length) return s.json({ items: [], total: 0, pages: 1, page: 1 });
    w.push('p.id IN (?)'); a.push(ids);
  }
  const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM products p ${W}`, a);
  const pages = Math.max(1, Math.ceil(n / per)), page = Math.min(Math.max(+q.query.page || 1, 1), pages);
  const [items] = await db.query(`SELECT ${PCOLS} FROM products p ${W} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...a, per, (page - 1) * per]);
  s.json({ items, total: n, pages, page });
}));
app.get('/api/products/:id', h(async (q, s) => {
  const [[p]] = await db.query(`SELECT ${PCOLS} FROM products p WHERE p.id=?`, [+q.params.id]);
  p ? s.json(p) : s.status(404).json({ error: 'Không tìm thấy sản phẩm' });
}));

// ----- Đơn hàng (khách) -----
app.post('/api/orders', auth(), h(async (q, s) => {
  const { name, phone, addr, pay, items } = q.body;
  if (!String(name || '').trim() || !/^[0-9]{9,11}$/.test(phone || '') || !String(addr || '').trim() || !['vietqr', 'cod'].includes(pay) || !Array.isArray(items) || !items.length)
    throw bad('Thông tin đơn hàng không hợp lệ');
  const want = new Map(); // gộp sản phẩm trùng
  for (const i of items) { const id = +i.id; if (id) want.set(id, (want.get(id) || 0) + Math.min(Math.max(parseInt(i.qty) || 1, 1), 999)); }
  if (!want.size) throw bad('Giỏ hàng trống');
  const [ps] = await db.query('SELECT id,name,price FROM products WHERE id IN (?)', [[...want.keys()]]);
  const rows = [...want].sort(([x], [y]) => x - y).map(([id, qty]) => { // sắp theo id để tránh deadlock
    const p = ps.find(x => x.id === id); if (!p) throw bad('Có sản phẩm không còn tồn tại, vui lòng kiểm tra lại giỏ hàng'); return { p, qty }; });
  const total = rows.reduce((t, r) => t + r.p.price * r.qty, 0), id = 'DH' + Date.now().toString().slice(-8);
  await tx(async c => {
    for (const r of rows) { // trừ tồn kho nguyên tử: chỉ trừ khi còn đủ hàng
      const [u] = await c.query('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?', [r.qty, r.p.id, r.qty]);
      if (!u.affectedRows) { const [[x]] = await c.query('SELECT stock FROM products WHERE id=?', [r.p.id]); throw bad(`"${r.p.name}" chỉ còn ${x ? x.stock : 0} sản phẩm trong kho`, 409); }
    }
    await c.query('INSERT INTO orders (id,user_id,name,phone,address,pay,total,status) VALUES (?,?,?,?,?,?,?,?)', [id, q.user.id, name.trim(), phone, addr.trim(), pay, total, STATUS[0]]);
    await c.query('INSERT INTO order_items (order_id,product_id,name,price,qty) VALUES ?', [rows.map(r => [id, r.p.id, r.p.name, r.p.price, r.qty])]);
  });
  s.json({ id, total });
}));
app.get('/api/orders', auth(), h(async (q, s) =>
  s.json(await withItems((await db.query(`SELECT ${ORDER_COLS} FROM orders WHERE user_id=? ORDER BY created_at DESC, id DESC`, [q.user.id]))[0]))));
app.get('/api/orders/:id/payment', auth(), h(async (q, s) => { // trang QR gọi định kỳ để biết đã nhận tiền chưa
  const [[o]] = await db.query('SELECT payment_status,status FROM orders WHERE id=? AND user_id=?', [q.params.id, q.user.id]);
  o ? s.json({ paid: o.payment_status === 'paid', status: o.status }) : s.status(404).json({ error: 'Không tìm thấy đơn hàng' });
}));
app.post('/api/orders/:id/cancel', auth(), h(async (q, s) => {
  await tx(async c => {
    const [[o]] = await c.query('SELECT status,payment_status FROM orders WHERE id=? AND user_id=? FOR UPDATE', [q.params.id, q.user.id]);
    if (!o || o.status !== STATUS[0]) throw bad('Không thể hủy đơn này');
    if (o.payment_status === 'paid') throw bad('Đơn đã thanh toán, vui lòng liên hệ cửa hàng để được hoàn tiền');
    await c.query('UPDATE orders SET status=? WHERE id=?', [STATUS[3], q.params.id]); await restock(c, q.params.id);
  });
  s.json({ ok: true });
}));

// ----- Webhook ngân hàng (SePay / Casso): tự xác nhận thanh toán -----
async function onPayment(provider, txId, amount, content) {
  if (txId === undefined || txId === null || txId === '') throw bad('Thiếu id giao dịch');
  amount = Math.round(+amount) || 0;
  const text = String(content || ''), m = text.toUpperCase().match(/DH\d{8}/);
  await tx(async c => {
    // UNIQUE(provider, tx_id) giúp chống xử lý trùng khi nhà cung cấp gọi lại webhook
    const [ins] = await c.query('INSERT IGNORE INTO bank_transactions (provider,tx_id,amount,content,note) VALUES (?,?,?,?,?)', [provider, String(txId), amount, text.slice(0, 500), '']);
    if (!ins.affectedRows) return;
    let orderId = null, note = 'Không tìm thấy mã đơn trong nội dung';
    if (m) {
      const [[o]] = await c.query('SELECT total,status,payment_status FROM orders WHERE id=? FOR UPDATE', [m[0]]);
      if (!o) note = 'Mã đơn không tồn tại';
      else {
        orderId = m[0];
        if (o.payment_status === 'paid') note = 'Đơn đã thanh toán trước đó (có thể khách chuyển trùng)';
        else if (o.status === STATUS[3]) note = 'Đơn đã hủy - cần xử lý/hoàn tiền thủ công';
        else if (amount < o.total) note = `Thiếu tiền: nhận ${amount}, cần ${o.total}`;
        else { await c.query("UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE id=?", [orderId]); note = amount > o.total ? 'Đã thanh toán (thừa tiền)' : 'Đã thanh toán tự động'; }
      }
    }
    await c.query('UPDATE bank_transactions SET order_id=?, note=? WHERE id=?', [orderId, note, ins.insertId]);
    console.log(`💰 [${provider}] ${amount}đ "${text.slice(0, 60)}" → ${orderId || '-'}: ${note}`);
  });
}
app.post('/api/webhook/sepay', h(async (q, s) => { // SePay: Authorization: Apikey <SEPAY_API_KEY>
  if (!E.SEPAY_API_KEY || !same(q.headers.authorization || '', 'Apikey ' + E.SEPAY_API_KEY)) return s.status(401).json({ success: false });
  const b = q.body || {};
  if (b.transferType === 'in') await onPayment('sepay', b.id, b.transferAmount, `${b.code || ''} ${b.content || ''}`);
  s.json({ success: true });
}));
app.post('/api/webhook/casso', h(async (q, s) => { // Casso (Webhook): header secure-token
  if (!E.CASSO_SECURE_TOKEN || !same(q.headers['secure-token'] || '', E.CASSO_SECURE_TOKEN)) return s.status(401).json({ success: false });
  const d = q.body && q.body.data;
  for (const t of Array.isArray(d) ? d : d ? [d] : []) if (+t.amount > 0) await onPayment('casso', t.id ?? t.tid, t.amount, t.description);
  s.json({ error: 0, success: true });
}));

// Tự hủy đơn VietQR quá hạn chưa thanh toán và trả lại tồn kho
async function expireUnpaid() {
  if (!PAY_TIMEOUT) return;
  try {
    const [os] = await db.query("SELECT id FROM orders WHERE pay='vietqr' AND payment_status='unpaid' AND status=? AND created_at < NOW() - INTERVAL ? MINUTE", [STATUS[0], PAY_TIMEOUT]);
    for (const o of os) await tx(async c => {
      const [[r]] = await c.query('SELECT status,payment_status FROM orders WHERE id=? FOR UPDATE', [o.id]);
      if (r.status === STATUS[0] && r.payment_status === 'unpaid') { await c.query('UPDATE orders SET status=? WHERE id=?', [STATUS[3], o.id]); await restock(c, o.id); console.log('⏱ Hủy đơn quá hạn thanh toán:', o.id); }
    });
  } catch (e) { console.error('expireUnpaid:', e.message); }
}
setInterval(expireUnpaid, 5 * 60 * 1000); expireUnpaid();

// ----- Quản trị viên -----
app.use('/api/admin', auth('admin'));
app.get('/api/admin/stats', h(async (q, s) => s.json((await db.query(`SELECT
  (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM categories) categories, (SELECT COUNT(*) FROM orders) orders,
  (SELECT COUNT(*) FROM orders WHERE status=?) pending, (SELECT COUNT(*) FROM products WHERE stock<=5) low,
  (SELECT COALESCE(SUM(total),0) FROM orders WHERE status=?) revenue`, [STATUS[0], STATUS[2]]))[0][0])));

app.post('/api/admin/categories', h(async (q, s) => {
  const n = String(q.body.name || '').trim(); if (!n) throw bad('Thiếu tên danh mục');
  const [r] = await db.query('INSERT INTO categories (name) VALUES (?)', [n]); s.json({ id: r.insertId, name: n });
}));
app.put('/api/admin/categories/:id', h(async (q, s) => {
  const n = String(q.body.name || '').trim(); if (!n) throw bad('Thiếu tên danh mục');
  await db.query('UPDATE categories SET name=? WHERE id=?', [n, +q.params.id]); s.json({ ok: true });
}));
app.delete('/api/admin/categories/:id', h(async (q, s) => { await db.query('DELETE FROM categories WHERE id=?', [+q.params.id]); s.json({ ok: true }); }));

const prodData = (q, existing = '') => {
  const b = q.body, price = Math.round(+b.price), old = Math.round(+b.old_price) || 0, stock = Math.max(0, parseInt(b.stock) || 0);
  if (!String(b.name || '').trim() || !(price >= 0) || !+b.category_id) throw bad('Thiếu tên, giá hoặc danh mục');
  const img = q.file ? '/uploads/' + q.file.filename : String(b.img_url || '').trim() || existing;
  return [b.name.trim(), price, old > price ? old : 0, +b.category_id, img, b.description || '', stock];
};
app.post('/api/admin/products', upload.single('image'), h(async (q, s) => {
  const [r] = await db.query('INSERT INTO products (name,price,old_price,category_id,img,description,stock) VALUES (?,?,?,?,?,?,?)', prodData(q)); s.json({ id: r.insertId });
}));
app.put('/api/admin/products/:id', upload.single('image'), h(async (q, s) => {
  const [[p]] = await db.query('SELECT img FROM products WHERE id=?', [+q.params.id]); if (!p) throw bad('Không tìm thấy sản phẩm', 404);
  await db.query('UPDATE products SET name=?,price=?,old_price=?,category_id=?,img=?,description=?,stock=? WHERE id=?', [...prodData(q, p.img), +q.params.id]); s.json({ ok: true });
}));
app.delete('/api/admin/products/:id', h(async (q, s) => { await db.query('DELETE FROM products WHERE id=?', [+q.params.id]); s.json({ ok: true }); }));

app.get('/api/admin/orders', h(async (q, s) =>
  s.json(await withItems((await db.query(`SELECT ${ORDER_COLS} FROM orders ORDER BY created_at DESC, id DESC`))[0]))));
app.put('/api/admin/orders/:id/status', h(async (q, s) => {
  const st = q.body.status; if (!STATUS.includes(st)) throw bad('Trạng thái không hợp lệ');
  await tx(async c => {
    const [[o]] = await c.query('SELECT status,pay FROM orders WHERE id=? FOR UPDATE', [q.params.id]);
    if (!o) throw bad('Không tìm thấy đơn hàng', 404);
    if (o.status === STATUS[3] && st !== STATUS[3]) throw bad('Đơn đã hủy không thể mở lại');
    if (st === STATUS[3] && o.status !== STATUS[3]) await restock(c, q.params.id); // hủy đơn → hoàn tồn kho
    const paid = st === STATUS[2] && o.pay === 'cod' ? ", payment_status='paid', paid_at=NOW()" : ''; // COD: giao xong = đã thu tiền
    await c.query(`UPDATE orders SET status=?${paid} WHERE id=?`, [st, q.params.id]);
  });
  s.json({ ok: true });
}));
app.put('/api/admin/orders/:id/paid', h(async (q, s) => { // xác nhận thủ công khi webhook chưa báo
  const [r] = await db.query("UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE id=? AND payment_status='unpaid' AND status<>?", [q.params.id, STATUS[3]]);
  if (!r.affectedRows) throw bad('Không thể xác nhận đơn này'); s.json({ ok: true });
}));

// ----- Static & lỗi -----
app.use('/api', (q, s) => s.status(404).json({ error: 'API không tồn tại' }));
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, 'public')));
app.use((e, q, s, n) => {
  let st = e.status || (e instanceof multer.MulterError ? 400 : e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_DUP_ENTRY' ? 409 : 500), m = st < 500 ? e.message : 'Lỗi máy chủ';
  if (e.code === 'ER_ROW_IS_REFERENCED_2') m = 'Danh mục đang có sản phẩm, không thể xóa';
  if (e.code === 'ER_DUP_ENTRY') m = 'Dữ liệu đã tồn tại';
  if (e.code === 'LIMIT_FILE_SIZE') m = 'Ảnh tối đa 3MB';
  if (st === 500) console.error(e);
  s.status(st).json({ error: m });
});
app.listen(E.PORT || 3000, () => console.log(`🌿 Vườn Nhà chạy tại http://localhost:${E.PORT || 3000}`));
