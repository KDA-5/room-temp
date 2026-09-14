import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    // QR 코드 라이브러리는 QR 패널을 열 때만 동적으로 불러오므로
    // 첫 로딩에 끼어들지 않게 별도 청크로 둡니다.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    open: true,
  },
});
