# Vương quốc Kawaii 🌸

Ứng dụng web chat thời gian thực bằng Node.js, Express, Socket.IO và SQLite.

## Chạy trên máy

```bash
npm install
cp .env.example .env
# Đổi JWT_SECRET trong .env trước khi deploy
npm start
```

Mở `http://localhost:3000`.

## Có sẵn

- Đăng ký/đăng nhập bằng tài khoản và mật khẩu đã được băm bằng bcrypt.
- Cookie phiên đăng nhập HttpOnly và giới hạn tốc độ cho API xác thực.
- Phòng chat chung thời gian thực qua Socket.IO.
- Lưu 100 tin nhắn gần nhất trong SQLite.
- Trạng thái online, số người đang online và chỉ báo đang nhập.
- Giao diện responsive pastel, chọn avatar kawaii.

## Deploy

Dùng Node.js 18+ và đặt `JWT_SECRET` là chuỗi bí mật dài. Ứng dụng cần một filesystem có thể ghi để lưu `kawaii.db`; nếu host dùng filesystem tạm thời, hãy thay SQLite bằng database được quản lý.
