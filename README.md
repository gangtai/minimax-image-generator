# 超級偵探訓練營 - AI 圖片生成器

## ⚙️ Vercel 環境變數設定

部署時需要在 Vercal 設定環境變數：

| 變數名稱 | 值 | 必要性 |
|---------|---|--------|
| MINIMAX_API_KEY | 你的 MiniMax Token Plan API Key | 建議 |
| GEMINI_API_KEY | 你的 Gemini API Key | 備用 |
| APP_PASSWORD | 你自訂的密碼 | 必要 |

**當 MiniMax 失敗時，會自動嘗試 Gemini 作為備用！**

## 🚀 部署步驟

1. Import 專案到 Vercel
2. 在 Environment Variables 加入：
   - `MINIMAX_API_KEY` = 你的 MiniMax Token
   - `GEMINI_API_KEY` = 你的 Gemini API Key（可選）
   - `APP_PASSWORD` = 你想要的密碼
3. 完成！

## 🔐 安全機制

- 密碼：從環境變數讀取（不在程式碼中）
- 速率限制：每 IP 每小時 10 次
- 內容過濾：阻擋不當關鍵字

## 📱 使用方式

1. 打開網址
2. 輸入密碼
3. 輸入圖片描述或點擊範例
4. 點擊生成
5. 下載圖片上傳到 Padlet
