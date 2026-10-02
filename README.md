# Vườn Nhà – Express + MySQL

1. Cài Node.js (>= 18) và MySQL (đang chạy).
2. `npm install`
3. Sao chép `.env.example` thành `.env` và điền thông tin.
4. `npm run setup`  → tạo/nâng cấp database, dữ liệu mẫu, tài khoản admin (chạy lại an toàn).
5. `npm start`  → mở http://localhost:3000

## Quên mật khẩu qua email
Điền SMTP_* và BASE_URL trong `.env` (Gmail: bật xác minh 2 bước → tạo "Mật khẩu ứng dụng" → dùng làm SMTP_PASS,
SMTP_HOST=smtp.gmail.com, SMTP_PORT=587). Chưa điền SMTP thì liên kết được in ra terminal để thử.

## Tồn kho
Mỗi sản phẩm có số lượng tồn (Admin → Sản phẩm). Đặt hàng tự trừ kho; hủy đơn / đơn VietQR quá hạn tự hoàn kho.

## Tự xác nhận VietQR (SePay hoặc Casso)
Webhook URL (phải là địa chỉ công khai, HTTPS khi chạy thật):
- SePay: `https://TÊN-MIỀN/api/webhook/sepay`  – xác thực "API Key", giá trị = SEPAY_API_KEY
- Casso: `https://TÊN-MIỀN/api/webhook/casso`  – secure-token = CASSO_SECURE_TOKEN
Nội dung chuyển khoản chứa mã đơn dạng `DH12345678`; đủ tiền thì đơn tự chuyển "Đã thanh toán".

Thử webhook trên máy bằng curl (SePay):
curl -X POST http://localhost:3000/api/webhook/sepay -H "Content-Type: application/json" -H "Authorization: Apikey KHÓA_CỦA_BẠN" -d '{"id":1001,"transferType":"in","transferAmount":150000,"content":"DH12345678 thanh toan"}'
