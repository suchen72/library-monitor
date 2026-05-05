# Library Monitor

台北市立圖書館借閱儀表板 — 整合多個借閱帳號的借閱與預約狀態，透過本地網頁即時查看。

## 功能

- **多帳號管理** — 同時追蹤多張借閱證的借閱與預約資料
- **自動更新** — 每天 22:00 自動抓取最新資料（可自訂）
- **手動更新** — 儀表板上一鍵觸發即時更新
- **Email 通知** — 自動寄信提醒以下狀況：
  - 借閱書籍 2 天內到期
  - 預約書到館（第一天通知）
  - 預約書領取截止日 2 天內
- **Session 持久化** — 登入後儲存 session，避免每次都需要輸入驗證碼
- **即時進度** — 透過 SSE 在儀表板上顯示更新進度
- **願望清單** — 支援多標籤、館藏搜尋、館藏/可預約/等待數排序、已借過篩選與直接預約
- **書單審核匯入** — 從 `data/booklist.csv` 產生人工審核用 CSV，再只匯入核准列到願望清單

## 技術架構

| 元件 | 技術 | 說明 |
|------|------|------|
| 爬蟲 | Playwright | 模擬瀏覽器登入並抓取資料 |
| 伺服器 | Express.js | API + 靜態檔案服務 |
| 前端 | HTML + Vanilla JS | 無需建置步驟 |
| 排程 | node-cron | 定時自動更新 |
| 通知 | Nodemailer | Gmail SMTP 寄信 |
| 資料儲存 | JSON 檔案 | 輕量、免設定 |

## 安裝

```bash
# Clone
git clone https://github.com/suchen72/library-monitor.git
cd library-monitor

# 安裝依賴
npm install

# 安裝 Playwright 瀏覽器
npx playwright install chromium
```

## 設定

複製 `.env.example` 為 `.env`，填入帳號資訊：

```bash
cp .env.example .env
```

```env
# 圖書館帳號（可設定多組，編號從 1 開始）
ACCOUNT1_LABEL=我的帳號
ACCOUNT1_CARD=借閱證號
ACCOUNT1_PASSWORD=密碼

ACCOUNT2_LABEL=第二個帳號
ACCOUNT2_CARD=借閱證號
ACCOUNT2_PASSWORD=密碼

# Email 通知（選填，不需要可設 EMAIL_ENABLED=false）
EMAIL_ENABLED=true
EMAIL_RECIPIENT=收件人@gmail.com
EMAIL_SENDER=寄件人@gmail.com
EMAIL_APP_PASSWORD=Gmail應用程式密碼
```

### Gmail App Password

Email 通知需要 Gmail 應用程式密碼（非帳號密碼）：

1. 前往 [Google 帳號安全性](https://myaccount.google.com/security)
2. 開啟兩步驟驗證
3. 搜尋「應用程式密碼」並建立一組新密碼
4. 將產生的 16 碼密碼填入 `EMAIL_APP_PASSWORD`

## 使用

```bash
# 啟動伺服器
npm start

# 開發模式（自動重啟）
npm run dev
```

開啟 http://localhost:3000 即可使用儀表板。

## 願望清單書單審核

用 `data/booklist.csv` 批次建立願望清單前，先產生人工審核檔：

```bash
node src/generateWishlistReview.js 300
```

這會寫出 `data/wishlist-review.csv`。審核時在 `reviewDecision` 欄填入：

- `add`：匯入該列。
- 空白或 `skip`：不匯入。

匯入審核通過的列：

```bash
node src/importWishlistReview.js
```

匯入腳本只接受 `matchStatus=matched` 且 `dataType=common:webpac.dataType.book` 的列，並會加入 `包包`、`閱讀小博士` 標籤。若網站讀取 Cloudflare KV，匯入後需同步遠端願望清單：

```bash
node -e "const {readWishlist,pushWishlistToKV}=require('./src/dataStore'); pushWishlistToKV(readWishlist()).then(()=>console.log('wishlist KV sync done')).catch(err=>{ console.error(err.message); process.exit(1); });"
```

## Feature Log

- 2026-05-05: 完成 `booklist.csv` → `wishlist-review.csv` → wishlist 的人工審核匯入流程。產生器會排除非圖書資料型別，標記短書名/非完全同名等需要人工確認的列；匯入器會保留館藏欄位並合併既有願望清單標籤。
- 2026-05-05: 已將審核後的 `add` 列同步到 Cloudflare KV。遠端願望清單共 441 筆，其中 225 筆帶 `閱讀小博士` 標籤。

## Roadmap

- 將審核匯入流程接到 UI：上傳 `booklist.csv`、預覽候選、人工核准、匯入與同步 KV 不再依賴命令列。
- 匯入後自動同步 Cloudflare KV，並在失敗時顯示可重試的錯誤。
- 讓願望清單篩選標籤直接合併 favorites 與 wishlist 的 tags，避免 wishlist-only tag 沒有篩選按鈕。
- 強化審核列的去重與已擁有狀態檢查：願望清單、目前借閱、預約清單與借閱史都應回寫到 `reviewNote`。
- 針對短書名與多版本候選提供更清楚的版本/作者比較，降低人工確認成本。

### 首次登入

首次使用或 session 過期時，系統會開啟可見的瀏覽器視窗，帳號密碼會自動填入，你只需要：

1. 在瀏覽器視窗中輸入**驗證碼（CAPTCHA）**
2. 點擊登入

登入成功後 session 會自動儲存，後續更新將以背景（headless）模式執行，無需再次輸入驗證碼。

## 開機自動啟動（macOS）

專案提供 `launchd` 設定檔，可讓伺服器在 Mac 開機後自動執行：

```bash
# 編輯 plist 中的路徑，改為你的實際安裝路徑
vim launchd/com.user.librarydashboard.plist

# 複製到 LaunchAgents
cp launchd/com.user.librarydashboard.plist ~/Library/LaunchAgents/

# 載入
launchctl load ~/Library/LaunchAgents/com.user.librarydashboard.plist
```

## 專案結構

```
library-monitor/
├── .env.example        # 環境變數範本
├── package.json
├── src/
│   ├── server.js       # Express 伺服器 + SSE + 排程
│   ├── scraper.js      # Playwright 登入 + 資料抓取
│   ├── dataStore.js    # 帳號讀取 + JSON 資料存取
│   ├── generateWishlistReview.js # 書單審核 CSV 產生器
│   ├── importWishlistReview.js   # 審核後願望清單匯入器
│   └── notifier.js     # Email 通知邏輯
├── docs/
│   ├── index.html      # 儀表板頁面
│   ├── style.css       # 樣式
│   └── app.js          # 前端邏輯 + SSE
├── launchd/            # macOS 開機自動啟動設定
├── sessions/           # Playwright session 檔案（gitignored）
└── data/               # 抓取資料快取（gitignored）
```

## License

MIT
