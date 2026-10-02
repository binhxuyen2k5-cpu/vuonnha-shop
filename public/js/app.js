// ===== Tiện ích & gọi API =====
const $ = (s, r = document) => r.querySelector(s);
const money = n => Number(n).toLocaleString('vi-VN') + 'đ';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROOT = location.pathname.includes('/admin/') ? '../' : '';
const STATUS = ['Chờ xác nhận', 'Đang giao', 'Hoàn thành', 'Đã hủy'];
const PER_PAGE = 8;
let SHOP = {}, BANK = {};
const me = () => { try { return JSON.parse(localStorage.vn_session); } catch { return null; } };

async function api(path, opt = {}) {
  const t = localStorage.vn_token, fd = opt.body instanceof FormData;
  let r;
  try {
    r = await fetch('/api' + path, { method: opt.method || 'GET', body: opt.body && !fd ? JSON.stringify(opt.body) : opt.body,
      headers: { ...(opt.body && !fd ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) } });
  } catch { throw new Error('Không kết nối được máy chủ. Hãy chạy "npm start" và mở http://localhost:3000'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi ' + r.status), { status: r.status });
  return d;
}
function toast(m) {
  let t = $('#toast') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toast' }));
  t.textContent = m; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 2200);
}
function clearSession() { localStorage.removeItem('vn_token'); localStorage.removeItem('vn_session'); }
function fail(e) { if (e.status === 401 && localStorage.vn_token) { clearSession(); location.href = ROOT + 'login.html'; } else toast(e.message); }
function logout() { clearSession(); location.href = ROOT + 'index.html'; }

const NOIMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="#e8f5e9"/><text x="50%" y="50%" fill="#2e7d32" font-size="28" text-anchor="middle" font-family="sans-serif">Vườn Nhà</text></svg>');
const pct = p => p.old > p.price ? Math.round((p.old - p.price) / p.old * 100) : 0;
const thumb = (p, cls = '') => `<div class="thumb ${cls}"><img src="${esc(p.img || NOIMG)}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src=NOIMG">${pct(p) ? `<span class="badge">-${pct(p)}%</span>` : ''}</div>`;
const priceHtml = p => `<span class="price">${money(p.price)}</span>${pct(p) ? ` <s class="old">${money(p.old)}</s> <span class="off">-${pct(p)}%</span>` : ''}`;
const stockHtml = p => p.stock <= 0 ? '<small class="out">Hết hàng</small>' : p.stock <= 5 ? `<small class="low">Chỉ còn ${p.stock} sản phẩm</small>` : `<small>Còn ${p.stock} sản phẩm</small>`;
const pagerHtml = (n, cur) => n < 2 ? '' : [cur > 1 ? ['‹ Trước', cur - 1] : null, ...Array.from({ length: n }, (_, i) => [i + 1, i + 1]), cur < n ? ['Sau ›', cur + 1] : null]
  .filter(Boolean).map(([t, p]) => `<button class="btn ${typeof t === 'number' && p === cur ? '' : 'gray'}" data-p="${p}">${t}</button>`).join('');

// ===== Giỏ hàng (lưu trình duyệt; giá luôn lấy từ máy chủ) =====
let cart = JSON.parse(localStorage.cart || '[]');
function addToCart(id, qty = 1, max = Infinity) {
  const i = cart.find(p => p.id === id), n = (i ? i.qty : 0) + qty;
  if (n > max) return toast(`Chỉ còn ${max} sản phẩm trong kho`);
  i ? i.qty = n : cart.push({ id, qty });
  updateCart(); toast('Đã thêm vào giỏ hàng!');
}
function updateQuantity(id, q, max = Infinity) {
  q = parseInt(q); if (!(q > 0)) return removeFromCart(id);
  if (q > max) { q = max; toast(`Chỉ còn ${max} sản phẩm trong kho`); }
  cart.find(p => p.id === id).qty = q; updateCart(); pages.cart();
}
function removeFromCart(id) { cart = cart.filter(p => p.id !== id); updateCart(); if (document.body.dataset.page === 'cart') pages.cart(); }
function updateCart() {
  localStorage.cart = JSON.stringify(cart);
  const e = $('#cart-count'); if (e) e.textContent = cart.reduce((s, i) => s + i.qty, 0);
}
async function cartLines() {
  if (!cart.length) return [];
  const { items } = await api('/products?per=50&ids=' + cart.map(i => i.id).join(','));
  let changed = false;
  const l = cart.map(i => {
    const p = items.find(x => x.id === i.id);
    if (!p || p.stock <= 0) { changed = true; return null; }          // hết hàng/không còn: bỏ khỏi giỏ
    const qty = Math.min(i.qty, p.stock); if (qty !== i.qty) changed = true; // vượt tồn kho: giảm xuống
    return { ...p, qty };
  }).filter(Boolean);
  if (changed) { cart = l.map(p => ({ id: p.id, qty: p.qty })); updateCart(); toast('Giỏ hàng đã được cập nhật theo tồn kho'); }
  return l;
}
const total = l => l.reduce((s, p) => s + p.price * p.qty, 0);
async function cancelOrder(id) { try { await api(`/orders/${id}/cancel`, { method: 'POST' }); pages.orders(); } catch (e) { fail(e); } }

// ===== Header & Footer =====
function header() {
  const u = me();
  $('#hdr').innerHTML = `<header><a class="logo" href="index.html">🌿 Vườn Nhà</a><nav>
    <a href="index.html">Sản phẩm</a><a href="cart.html">Giỏ hàng (<span id="cart-count">0</span>)</a><a href="orders.html">Đơn hàng</a>
    ${u?.role === 'admin' ? '<a href="admin/index.html">Quản trị</a>' : ''}
    ${u ? `<a href="#" onclick="logout()">Thoát (${esc(u.name)})</a>` : '<a href="login.html">Đăng nhập / Đăng ký</a>'}</nav></header>`;
  updateCart();
}
function footer() {
  document.body.insertAdjacentHTML('beforeend', `<footer class="site"><div class="cols">
    <div><h4>🌿 Vườn Nhà</h4><p>Nông sản sạch từ vườn đến bàn ăn.</p><p>📍 ${esc(SHOP.addr)}</p>
      <p>📞 <a style="color:#fff" href="tel:${esc((SHOP.phone || '').replace(/\s/g, ''))}">${esc(SHOP.phone)}</a></p>
      <p>✉️ <a style="color:#fff" href="mailto:${esc(SHOP.email)}">${esc(SHOP.email)}</a></p><p>🕒 ${esc(SHOP.hours)}</p></div>
    <div><h4>Chính sách</h4><ul>
      <li><b>Đổi trả:</b> trong 24 giờ nếu hàng hư hỏng, dập nát.</li>
      <li><b>Vận chuyển:</b> miễn phí đơn từ 300.000đ trong nội thành.</li>
      <li><b>Thanh toán:</b> COD hoặc chuyển khoản VietQR.</li>
      <li><b>Bảo mật:</b> thông tin khách hàng không chia sẻ cho bên thứ ba.</li></ul></div>
    <div><h4>Bản đồ cửa hàng</h4><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Bản đồ Vườn Nhà"
      src="https://www.google.com/maps?q=${encodeURIComponent(SHOP.addr || '')}&output=embed"></iframe></div></div>
    <div class="copy">© ${new Date().getFullYear()} Vườn Nhà. Bảo lưu mọi quyền.</div></footer>`);
}

const payTag = o => o.pay_status === 'paid' ? '<span class="tag" style="background:#c8e6c9">Đã thanh toán</span>'
  : o.pay === 'cod' || o.status === STATUS[3] ? '' : '<span class="tag" style="background:#fff3cd">Chưa thanh toán</span>';

// ===== Các trang phía Khách hàng =====
const pages = {
  async index() {
    let pageNo = 1, tm; const cats = await api('/categories').catch(() => []);
    $('#main').innerHTML = `<h1>Nông sản tươi từ Vườn Nhà</h1>
      <div class="bar"><input id="q" placeholder="🔍 Tìm sản phẩm..." style="flex:1;min-width:200px"><select id="cat"><option value="0">Tất cả danh mục</option>
      ${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div id="grid" class="grid"></div><div id="pager"></div>`;
    const draw = async () => {
      try {
        const r = await api('/products?' + new URLSearchParams({ q: $('#q').value.trim(), cat: $('#cat').value, page: pageNo, per: PER_PAGE }));
        pageNo = r.page;
        $('#grid').innerHTML = r.items.map(p => `<div class="card"><a href="detail.html?id=${p.id}">${thumb(p)}<h3>${esc(p.name)}</h3></a>
          <p>${priceHtml(p)}<br>${stockHtml(p)}</p><button class="btn" ${p.stock > 0 ? '' : 'disabled'} onclick="addToCart(${p.id},1,${p.stock})">${p.stock > 0 ? 'Thêm vào giỏ' : 'Hết hàng'}</button></div>`).join('') || '<p>Không có sản phẩm phù hợp.</p>';
        $('#pager').innerHTML = pagerHtml(r.pages, r.page);
      } catch (e) { fail(e); }
    };
    $('#pager').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { pageNo = +b.dataset.p; draw(); scrollTo(0, 0); } };
    $('#cat').onchange = () => { pageNo = 1; draw(); };
    $('#q').oninput = () => { clearTimeout(tm); tm = setTimeout(() => { pageNo = 1; draw(); }, 300); };
    draw();
  },

  async detail() {
    try {
      const p = await api('/products/' + (+new URLSearchParams(location.search).get('id') || 0));
      const c = (await api('/categories')).find(x => x.id === p.cat);
      $('#main').innerHTML = `<div class="box row" style="gap:24px;flex-wrap:wrap"><div style="flex:1 1 320px">${thumb(p, 'lg')}</div><div style="flex:1 1 320px">
        <h1>${esc(p.name)}</h1><span class="tag">${esc(c?.name || '')}</span>
        <p style="font-size:24px">${priceHtml(p)}</p>${pct(p) ? `<p>Tiết kiệm <b>${money(p.old - p.price)}</b></p>` : ''}<p>${esc(p.description)}</p>
        <p>${stockHtml(p)}</p>
        <div class="row">${p.stock > 0 ? `<input id="q" type="number" min="1" max="${p.stock}" value="1" style="width:70px">
        <button class="btn" onclick="addToCart(${p.id},Math.max(1,parseInt($('#q').value)||1),${p.stock})">Thêm vào giỏ</button>` : '<b class="out">Hết hàng</b>'}
        <a class="btn gray" href="index.html">← Tiếp tục mua</a></div></div></div>`;
    } catch (e) { $('#main').innerHTML = `<p>${esc(e.message)}. <a href="index.html">Về trang chủ</a></p>`; }
  },

  async cart() {
    try {
      const l = await cartLines();
      $('#main').innerHTML = '<h1>Giỏ hàng</h1>' + (l.length ? `<div class="tbl"><table>
        <tr><th>Sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th></th></tr>
        ${l.map(p => `<tr><td><div class="row" style="margin:0;align-items:center">${thumb(p, 'sm')}<a href="detail.html?id=${p.id}">${esc(p.name)}</a></div></td><td>${priceHtml(p)}</td>
        <td><input type="number" min="1" max="${p.stock}" value="${p.qty}" style="width:70px" onchange="updateQuantity(${p.id},this.value,${p.stock})"></td>
        <td>${money(p.price * p.qty)}</td><td><button class="btn red" onclick="removeFromCart(${p.id})">Xóa</button></td></tr>`).join('')}
        </table></div><h2>Tổng: ${money(total(l))}</h2><a class="btn" href="checkout.html">Đặt hàng</a>`
        : '<p>Giỏ hàng trống. <a href="index.html">Mua sắm ngay</a></p>');
    } catch (e) { fail(e); }
  },

  async checkout() {
    const u = me(); if (!u) { location.href = 'login.html?next=checkout.html'; return; }
    let l; try { l = await cartLines(); } catch (e) { return fail(e); }
    if (!l.length) { location.href = 'cart.html'; return; }
    $('#main').innerHTML = `<h1>Đặt hàng & Thanh toán</h1><form class="box" id="f">
      <input id="n" required placeholder="Họ tên" value="${esc(u.name)}">
      <input id="ph" required placeholder="Số điện thoại" pattern="[0-9]{9,11}">
      <textarea id="ad" required placeholder="Địa chỉ giao hàng"></textarea>
      <select id="pay"><option value="vietqr">Chuyển khoản VietQR</option><option value="cod">Thanh toán khi nhận hàng (COD)</option></select>
      <b>Tạm tính: ${money(total(l))}</b><button class="btn">Xác nhận đặt hàng</button></form>`;
    $('#f').onsubmit = async e => {
      e.preventDefault(); const btn = $('#f button'); btn.disabled = true;
      try {
        const pay = $('#pay').value;
        const o = await api('/orders', { method: 'POST', body: { name: $('#n').value, phone: $('#ph').value, addr: $('#ad').value, pay, items: cart } });
        cart = []; updateCart();
        if (pay === 'cod') { location.href = 'orders.html'; return; }
        const url = `https://img.vietqr.io/image/${BANK.id}-${BANK.no}-compact2.png?amount=${o.total}&addInfo=${encodeURIComponent(o.id)}&accountName=${encodeURIComponent(BANK.name)}`;
        $('#main').innerHTML = `<div class="box" style="text-align:center"><h2>Quét mã VietQR để thanh toán</h2>
          <p>Số tiền: <b>${money(o.total)}</b> — Nội dung (giữ nguyên): <b>${o.id}</b></p><img class="qr" src="${url}" alt="VietQR">
          <p id="paystat">⏳ Đang chờ thanh toán — hệ thống sẽ tự xác nhận khi nhận được tiền.</p>
          <a class="btn gray" href="orders.html">Xem đơn hàng của tôi</a></div>`;
        const t0 = Date.now(), iv = setInterval(async () => { // hỏi máy chủ mỗi 4 giây
          try {
            const r = await api(`/orders/${o.id}/payment`);
            if (r.paid) { clearInterval(iv); $('#paystat').innerHTML = '✅ <b>Đã nhận thanh toán!</b> Đang chuyển trang...'; setTimeout(() => location.href = 'orders.html', 1800); }
            else if (r.status === STATUS[3]) { clearInterval(iv); $('#paystat').textContent = 'Đơn đã bị hủy do quá hạn thanh toán.'; }
          } catch { /* thử lại lần sau */ }
          if (Date.now() - t0 > 3600000) clearInterval(iv);
        }, 4000);
      } catch (err) { btn.disabled = false; fail(err); }
    };
  },

  async orders() {
    if (!me()) { location.href = 'login.html?next=orders.html'; return; }
    try {
      const l = await api('/orders');
      $('#main').innerHTML = '<h1>Đơn hàng của tôi</h1>' + (l.map(o => `<details class="box"><summary><b>${o.id}</b> · ${new Date(o.date).toLocaleString('vi-VN')} · ${money(o.total)} · <span class="tag">${o.status}</span> ${payTag(o)}</summary>
        <p>${esc(o.name)} - ${esc(o.phone)}<br>${esc(o.addr)}<br>Thanh toán: ${o.pay === 'cod' ? 'COD' : 'VietQR'}</p>
        <ul>${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} = ${money(i.price * i.qty)}</li>`).join('')}</ul>
        ${o.status === STATUS[0] && o.pay_status !== 'paid' ? `<button class="btn red" onclick="cancelOrder('${o.id}')">Hủy đơn</button>` : ''}</details>`).join('') || '<p>Chưa có đơn hàng.</p>');
    } catch (e) { fail(e); }
  },

  forgot() {
    $('#main').innerHTML = `<form class="box" id="f" style="max-width:400px;margin:auto"><h2>Quên mật khẩu</h2>
      <p>Nhập email đã đăng ký, chúng tôi sẽ gửi liên kết đặt lại mật khẩu (hiệu lực 30 phút).</p>
      <input id="e" type="email" required placeholder="Email"><button class="btn">Gửi liên kết</button><a href="login.html">← Quay lại đăng nhập</a></form>`;
    $('#f').onsubmit = async e => {
      e.preventDefault(); const b = $('#f button'); b.disabled = true;
      try {
        const r = await api('/auth/forgot', { method: 'POST', body: { email: $('#e').value } });
        $('#f').innerHTML = `<h2>Kiểm tra email</h2><p>${esc(r.message)}</p><a href="login.html">← Quay lại đăng nhập</a>`;
      } catch (err) { b.disabled = false; toast(err.message); }
    };
  },

  reset() {
    const token = new URLSearchParams(location.search).get('token') || '';
    $('#main').innerHTML = `<form class="box" id="f" style="max-width:400px;margin:auto"><h2>Đặt lại mật khẩu</h2>
      <input id="p" type="password" required minlength="6" placeholder="Mật khẩu mới (≥ 6 ký tự)"><input id="p2" type="password" required placeholder="Nhập lại mật khẩu mới">
      <button class="btn">Đổi mật khẩu</button></form>`;
    $('#f').onsubmit = async e => {
      e.preventDefault();
      if ($('#p').value !== $('#p2').value) return toast('Mật khẩu nhập lại không khớp');
      try { await api('/auth/reset', { method: 'POST', body: { token, password: $('#p').value } }); toast('Đổi mật khẩu thành công!'); setTimeout(() => location.href = 'login.html', 1200); }
      catch (err) { toast(err.message); }
    };
  },

  login() {
    let reg = new URLSearchParams(location.search).get('mode') === 'register';
    const n = new URLSearchParams(location.search).get('next');
    const next = /^[\w-]+\.html$/.test(n || '') ? n : 'index.html';
    const draw = () => {
      $('#main').innerHTML = `<form class="box" id="f" style="max-width:400px;margin:auto"><h2>${reg ? 'Đăng ký tài khoản' : 'Đăng nhập'}</h2>
        ${reg ? '<input id="n" required placeholder="Họ tên">' : ''}<input id="e" type="email" required placeholder="Email">
        <input id="p" type="password" required minlength="6" placeholder="Mật khẩu (≥ 6 ký tự)">
        ${reg ? '<input id="p2" type="password" required placeholder="Nhập lại mật khẩu">' : ''}<button class="btn">${reg ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
        <a href="#" id="sw">${reg ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}</a>${reg ? '' : '<a href="forgot.html">Quên mật khẩu?</a>'}</form>`;
      $('#sw').onclick = e => { e.preventDefault(); reg = !reg; draw(); };
      $('#f').onsubmit = async e => {
        e.preventDefault();
        if (reg && $('#p').value !== $('#p2').value) return toast('Mật khẩu nhập lại không khớp');
        try {
          const r = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: { name: reg ? $('#n').value : undefined, email: $('#e').value, password: $('#p').value } });
          localStorage.vn_token = r.token; localStorage.vn_session = JSON.stringify(r.user);
          location.href = r.user.role === 'admin' ? 'admin/index.html' : next;
        } catch (err) { toast(err.message); }
      };
    };
    draw();
  }
};
(async () => {
  const pg = document.body.dataset.page; if (!pages[pg]) return;
  try { const c = await api('/config'); SHOP = c.shop; BANK = c.bank; } catch { /* hiển thị lỗi ở trang */ }
  header(); await pages[pg](); footer();
})();
