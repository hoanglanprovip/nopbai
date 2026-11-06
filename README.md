# Nộp bài

Dashboard quản lý nhóm thuyết trình với giao diện kính mờ đen–trắng: nền lụa ánh bạc gợn theo chuột, hạt kim tuyến bám trên bề mặt và thẻ nghiêng 3D theo vị trí con trỏ.

## Xem giao diện

Trang chạy trực tiếp bằng HTML/CSS/JavaScript, không cần build. Có thể mở `index.html` hoặc phục vụ thư mục qua HTTP:

```sh
npm run dev
```

GitHub Pages chỉ cần `index.html`, `styles.css` và `effects.js` ở cùng thư mục. Dữ liệu Firebase giữ nguyên cấu trúc `groups/{key}` với `stt`, `members` và `links`. Khi SDK không tải được, trang vẫn dùng chế độ lưu trên máy với khóa `nhom_thuyet_trinh_v1` như trước; dữ liệu này không tự đồng bộ lên Firebase.

Giao diện hỗ trợ tìm tên có hoặc không có dấu, bàn phím (Tab, Shift+Tab, Escape), màn hình nhỏ, `prefers-reduced-motion` và nền đặc thay thế khi trình duyệt không hỗ trợ backdrop blur.

`effects.js` dùng WebGL 2 cho mặt lụa và Canvas 2D cho tối đa 4.800 hạt kim tuyến. Hạt bị đẩy khỏi đường chuột rồi hồi về vị trí ban đầu; nền vẫn chuyển động khi WebGL không khả dụng. Thẻ có các lớp nội dung 3D và góc nghiêng tối đa 9° mỗi trục. Nền vẽ tối đa 30 fps; tab ẩn sẽ dừng.

Mặc định nền chuyển động nhẹ liên tục. Nếu Windows/trình duyệt yêu cầu giảm chuyển động, trang dùng chế độ nhẹ: phản hồi trực tiếp theo con trỏ, thẻ nghiêng tối đa 3°, không tự chạy nền. Nút **Hiệu ứng nhẹ** bật đầy đủ hiệu ứng ngay trên trang; nút **Hiệu ứng bật** tắt chuyển động. Lựa chọn được lưu trên thiết bị. Không cần thay đổi cài đặt Windows hoặc cài thêm thư viện. Chuột ngoài vẫn hoạt động trên máy cảm ứng; vuốt cảm ứng chỉ tác động nền, không nghiêng thẻ hoặc chặn cuộn.

Khi đưa lên GitHub Pages, giữ cả ba tệp giao diện cùng thư mục. Liên kết tài nguyên dùng đường dẫn tương đối kèm phiên bản, hỗ trợ cả đường dẫn dự án `/nopbai/`. Chạy `npm run dev` mở bản xem thử tại `http://127.0.0.1:4173`, không lưu bộ nhớ đệm.

## Kiểm thử

Cần Node.js 20 trở lên. Playwright chỉ dùng khi phát triển, không được tải vào website.

```sh
npm ci
npx playwright install chromium
npm test
```

Kiểm thử dùng dữ liệu mẫu và chặn kết nối bên ngoài, bao gồm Firebase thật. Bao phủ các thao tác nhóm, lỗi lưu/tải, liên kết, bàn phím, bố cục 320–1440px, phân tán/hồi phục hạt, nghiêng 3D, máy cảm ứng có chuột, giảm chuyển động, thiếu WebGL và đường dẫn GitHub Pages. Đặt `BROWSER_CHANNEL=msedge` để chạy trên Microsoft Edge đã cài. Ảnh chụp được lưu trong `test-results/` (không đưa lên Git).
