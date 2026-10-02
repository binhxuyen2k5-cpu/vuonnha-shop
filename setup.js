// Tạo database + bảng + dữ liệu mẫu + tài khoản admin:  npm run setup
require('dotenv').config();
const fs = require('fs'), mysql = require('mysql2/promise'), bcrypt = require('bcryptjs');
(async () => {
  const e = process.env, name = (e.DB_NAME || 'vuonnha').replace(/[^\w]/g, '');
  const c = await mysql.createConnection({ host: e.DB_HOST || 'localhost', user: e.DB_USER || 'root', password: e.DB_PASSWORD || '', multipleStatements: true });
  await c.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.query(`USE \`${name}\``);
  await c.query(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
  const has = async (t, col) => (await c.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [name, t, col]))[0].length > 0;
  if (!(await has('products', 'stock'))) { // nâng cấp database cũ
    await c.query('ALTER TABLE products ADD COLUMN stock INT NOT NULL DEFAULT 0'); await c.query('UPDATE products SET stock=100');
    console.log('• Đã thêm cột tồn kho cho sản phẩm cũ (mặc định 100, hãy chỉnh lại trong Admin)');
  }
  if (!(await has('orders', 'payment_status')))
    await c.query("ALTER TABLE orders ADD COLUMN payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid', ADD COLUMN paid_at TIMESTAMP NULL DEFAULT NULL");
  const [[{ n }]] = await c.query('SELECT COUNT(*) n FROM products');
  if (!n) await c.query(fs.readFileSync(__dirname + '/seed.sql', 'utf8'));
  const em = (e.ADMIN_EMAIL || 'admin@vuonnha.vn').toLowerCase();
  const [u] = await c.query('SELECT id FROM users WHERE email=?', [em]);
  if (!u.length) await c.query("INSERT INTO users (name,email,password_hash,role) VALUES ('Quản trị viên',?,?,'admin')", [em, await bcrypt.hash(e.ADMIN_PASSWORD || 'admin123', 10)]);
  console.log(`✔ Database "${name}" sẵn sàng. Admin: ${em}`);
  await c.end();
})().catch(x => { console.error('✖ Lỗi:', x.message); process.exit(1); });
