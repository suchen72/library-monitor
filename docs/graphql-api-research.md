# GraphQL API 研究報告

## 日期
2026-03-31

## 目的
調查 book.tpml.edu.tw 的 GraphQL API (`/api/HyLibWS/graphql`) 是否能繞過 CAPTCHA，實現全自動登入。

## 發現

### 登入流程（GraphQL）

網站的登入完全透過 GraphQL mutation 完成：

1. 頁面載入時從 `<meta name="csrf-token">` 取得 CSRF token
2. `getCaptcha` query 取得 CAPTCHA 圖片（base64 encoded）
3. `mutation SSOLogin($user, $pass, $captcha)` 執行登入，回傳 `sessionID`

```graphql
mutation SSOLogin($user: String!, $pass: String!, $captcha: String) {
  ssoLogin(user: $user, pass: $pass, captcha: $captcha) {
    success
    message
    sessionID
    errorType
    licenseStatus
    chPaLink
    ttl
    loginChooseReaderList {
      readerId
      readerCode
      readerName
      licenseStatusId
      readerTypeId
      keepsiteId
      memberPic
    }
  }
}
```

### 資料查詢 API

登入後可用以下 queries 取得資料（需帶 `x-csrf-token` header + session cookies）：

- **借閱書籍**: `getLendFile(Input: $queryForm)` → 回傳 `list[].values[].ref { key, value }`
- **預約書籍**: `getTPMLReadBook(Input: $queryForm)` → 同上結構

### API 存取條件

| 條件 | 說明 |
|------|------|
| `x-csrf-token` header | 必須，否則回 403 |
| Session cookies | 必須已登入 |
| `credentials: 'include'` | 必須帶 cookies |
| Introspection | 被禁止（403） |

### 其他發現的 mutations

- `ssoChooseLogin(readerId)` — SSO 多帳號選擇
- `SSOLogoutRecord` — 登出
- `saveLostCard(code, password, ip)` — 掛失借閱證

## 結論

**GraphQL API 無法繞過 CAPTCHA。** `SSOLogin` mutation 的 `captcha` 參數是必要的，而 CAPTCHA 圖片需要人工辨識。

目前的 Playwright 方案（session reuse + CAPTCHA fallback）已是最佳做法。

## 可能的後續方向

- OCR/AI 自動辨識 CAPTCHA（`getCaptcha` 回傳的 base64 圖片）
- 改用 GraphQL API 取資料（比 DOM scraping 更穩定），但登入仍需 Playwright + CAPTCHA
