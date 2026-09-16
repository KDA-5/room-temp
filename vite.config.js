import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages 는 https://<아이디>.github.io/<저장소>/ 아래에 놀입니다.
  // 배포 워크플로우가 VITE_BASE 를 넘겨주고, 로컬 개발은 그냥 / 입니다.
  base: process.env.VITE_BASE || "/",
  build: {
    target: "es2020",
    // QR 코드 라이브러리는 QR 패널을 열 때만 동적으로 불러오므로
    // 첫 로딩에 끼어들지 않게 별도 청크로 둡니다.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    open: true,
    // 같은 와이파이의 폰에서도 열리게 랜 주소에도 붙습니다.
    // (localhost 만 띄우면 QR 을 찍은 폰이 "폰 자기 자신"을 찾아가서 실패해요)
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
