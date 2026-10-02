// ===== Phân hệ Quản trị viên (dùng chung tiện ích từ app.js; quyền được kiểm tra lại ở máy chủ) =====
const adm = me();
if (!adm || adm.role !== 'admin') { alert('Cần đăng nhập bằng tài khoản quản trị viên'); location.href = '../login.html'; }
let adminPage = 1;
const go = name => ADMIN[name]().catch(fail);

async function editP(id) {
  try {
    const p = await api('/products/' + id);
    $('#id').value = p.id; $('#n').value = p.name; $('#pr').value = p.price; $('#old').value = p.old || ''; $('#st').value = p.stock; $('#c').value = p.cat; $('#d').value = p.description || '';
    $('#im').value = p.img; $('#pv').src = p.img || NOIMG; $('#pv').style.display = 'block'; scrollTo(0, 0);
  } catch (e) { fail(e); }
}
async function delP(id) {
  if (!confirm('Xóa sản phẩm này?')) return;
  try { await api('/admin/products/' + id, { method: 'DELETE' }); go('admin-products'); } catch (e) { fail(e); }
}
async function renameC(id, old) {
  const n = prompt('Tên danh mục mới:', old);
  if (n && n.trim()) try { await api('/admin/categories/' + id, { method: 'PUT', body: { name: n.trim() } }); go('admin-categories'); } catch (e) { fail(e); }
}
async function delC(id) {
  if (!confirm('Xóa danh mục này?')) return;
  try { await api('/admin/categories/' + id, { method: 'DELETE' }); go('admin-categories'); } catch (e) { fail(e); }
}
async function setStatus(id, v) {
  try { await api(`/admin/orders/${id}/status`, { method: 'PUT', body: { status: v } }); toast('Đã cập nhật trạng thái'); } catch (e) { fail(e); }
  go('admin-orders'); // tải lại để khớp với thanh toán/tồn kho
}
async function markPaid(id) {
  if (!confirm('Xác nhận đã nhận đủ tiền cho đơn ' + id + '?')) return;
  try { await api(`/admin/orders/${id}/paid`, { method: 'PUT' }); toast('Đã xác nhận thanh toán'); } catch (e) { fail(e); }
  go('admin-orders');
}

const ADMIN = {
  async 'admin-home'() {
    const s = await api('/admin/stats');
    $('#main').innerHTML = `<h1>Tổng quan</h1><div class="stat">
      <div class="box"><b>${s.products}</b>Sản phẩm</div><div class="box"><b>${s.categories}</b>Danh mục</div><div class="box"><b style="color:${s.low ? '#c62828' : 'inherit'}">${s.low}</b>Sản phẩm sắp hết hàng (≤ 5)</div>
      <div class="box"><b>${s.orders}</b>Đơn hàng (${s.pending} chờ xác nhận)</div>
      <div class="box"><b>${money(s.revenue)}</b>Doanh thu (đơn hoàn thành)</div></div>`;
  },

  async 'admin-products'() {
    const cats = await api('/categories'), r = await api(`/products?per=10&page=${adminPage}`); adminPage = r.page;
    $('#main').innerHTML = `<h1>Quản lý sản phẩm</h1>${cats.length ? '' : '<p>⚠️ Hãy tạo danh mục trước.</p>'}<form class="box" id="f"><input type="hidden" id="id">
      <div class="row"><input id="n" required placeholder="Tên sản phẩm"><input id="pr" type="number" min="0" required placeholder="Giá bán (VNĐ)">
      <input id="old" type="number" min="0" placeholder="Giá gốc (nếu khuyến mãi)"><input id="st" type="number" min="0" required placeholder="Tồn kho (số lượng)">
      <select id="c" required>${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="row" style="align-items:center"><label>Ảnh thật (≤ 3MB): <input type="file" id="fi" accept="image/*"></label>
      <input id="im" placeholder="hoặc dán URL ảnh https://..." style="flex:1"><img id="pv" alt="xem trước"></div>
      <textarea id="d" placeholder="Mô tả"></textarea>
      <div class="row"><button class="btn">Lưu sản phẩm</button><button type="button" class="btn gray" onclick="go('admin-products')">Làm mới form</button></div></form>
      <div class="tbl"><table><tr><th>Ảnh</th><th>Tên</th><th>Danh mục</th><th>Giá</th><th>Tồn kho</th><th>Hành động</th></tr>
      ${r.items.map(p => `<tr><td>${thumb(p, 'sm')}</td><td>${esc(p.name)}</td><td>${esc(cats.find(c => c.id === p.cat)?.name || '-')}</td><td>${priceHtml(p)}</td><td>${p.stock <= 5 ? `<b style="color:#c62828">${p.stock}</b>` : p.stock}</td>
      <td><button class="btn" onclick="editP(${p.id})">Sửa</button> <button class="btn red" onclick="delP(${p.id})">Xóa</button></td></tr>`).join('')}</table></div><div id="pager">${pagerHtml(r.pages, r.page)}</div>`;
    $('#pager').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { adminPage = +b.dataset.p; go('admin-products'); } };
    const show = src => { $('#pv').src = src; $('#pv').style.display = 'block'; };
    $('#im').oninput = () => show($('#im').value);
    $('#fi').onchange = e => { const f = e.target.files[0]; if (f) show(URL.createObjectURL(f)); };
    $('#f').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(), id = $('#id').value;
      fd.append('name', $('#n').value); fd.append('price', $('#pr').value); fd.append('old_price', $('#old').value || 0);
      fd.append('category_id', $('#c').value); fd.append('stock', $('#st').value || 0); fd.append('description', $('#d').value); fd.append('img_url', $('#im').value);
      if ($('#fi').files[0]) fd.append('image', $('#fi').files[0]);
      try { await api('/admin/products' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: fd }); toast('Đã lưu sản phẩm'); go('admin-products'); } catch (err) { fail(err); }
    };
  },

  async 'admin-categories'() {
    const cs = await api('/categories');
    $('#main').innerHTML = `<h1>Quản lý danh mục</h1><form class="box" id="f"><div class="row"><input id="n" required placeholder="Tên danh mục"><button class="btn">Thêm danh mục</button></div></form>
      <div class="tbl"><table><tr><th>ID</th><th>Tên</th><th>Hành động</th></tr>${cs.map(c => `<tr><td>${c.id}</td><td>${esc(c.name)}</td>
      <td><button class="btn" onclick="renameC(${c.id},'${esc(c.name).replace(/'/g, "\\'")}')">Sửa</button> <button class="btn red" onclick="delC(${c.id})">Xóa</button></td></tr>`).join('')}</table></div>`;
    $('#f').onsubmit = async e => { e.preventDefault(); try { await api('/admin/categories', { method: 'POST', body: { name: $('#n').value } }); go('admin-categories'); } catch (err) { fail(err); } };
  },

  async 'admin-orders'() {
    const os = await api('/admin/orders');
    $('#main').innerHTML = '<h1>Quản lý đơn hàng</h1><div class="tbl"><table><tr><th>Mã</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng</th><th>Thanh toán</th><th>Trạng thái</th></tr>' +
      (os.map(o => `<tr><td>${o.id}<br><small>${new Date(o.date).toLocaleString('vi-VN')}</small></td><td>${esc(o.name)}<br>${esc(o.phone)}<br><small>${esc(o.addr)}</small></td>
      <td>${o.items.map(i => `${esc(i.name)} ×${i.qty}`).join('<br>')}</td><td>${money(o.total)}</td><td>${o.pay === 'cod' ? 'COD' : 'VietQR'}<br>${o.pay_status === 'paid' ? '<span class="tag" style="background:#c8e6c9">Đã thanh toán</span>'
        : o.status === STATUS[3] ? '' : `<span class="tag" style="background:#fff3cd">Chưa thanh toán</span><br><button class="btn" style="margin-top:4px" onclick="markPaid('${o.id}')">Xác nhận đã nhận tiền</button>`}</td>
      <td><select ${o.status === STATUS[3] ? 'disabled' : ''} onchange="setStatus('${o.id}',this.value)">${STATUS.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
      || '<tr><td colspan="6">Chưa có đơn hàng.</td></tr>') + '</table></div>';
  }
};

if (adm && adm.role === 'admin') {
  $('#hdr').innerHTML = `<header><a class="logo" href="index.html">🌿 Admin Vườn Nhà</a><nav><a href="index.html">Tổng quan</a><a href="products.html">Sản phẩm</a>
    <a href="categories.html">Danh mục</a><a href="orders.html">Đơn hàng</a><a href="../index.html">Xem shop</a><a href="#" onclick="logout()">Thoát</a></nav></header>`;
  go(document.body.dataset.page);
}
