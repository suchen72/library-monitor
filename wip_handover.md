# WIP Handover: Notification Routing and Wishlist Review Closeout

## Current Objective

- Close out notification routing and CSV booklist wishlist review docs.
- Keep roadmap details in README.
- Update feature log and WIP handover.
- Commit and push the completed cleanup.

## Completed Progress

- Updated notification routing.
  - Daily automatic refresh now runs at 10:00 Taiwan time in GitHub Actions and local `node-cron`.
  - Daily automatic refresh sends both LINE push and Email regardless of alert count.
  - Browser-triggered refresh writes refreshed data to Cloudflare KV but does not send LINE push or Email.
  - LINE-triggered GitHub Actions runs are marked with `source=line`, write refreshed data to Cloudflare KV, and report only to LINE.
  - Manual GitHub workflow runs default to `source=manual`, report to LINE only, and do not send Email.
- Split notification channels in `src/notifier.js`.
  - Notification helpers now accept `{ line, email }` channels.
  - Email is only enabled for `source=schedule` / scheduled server cron paths.
- Synced account state after mutations.
  - Browser single-book renew, bulk renew, and reservation success now start a non-notifying refresh to update Cloudflare KV.
  - LINE/GitHub renew success now re-scrapes and syncs Cloudflare KV before reporting the renew result.
  - Daily auto-renew success re-scrapes and uses fresh data for the daily notification.
- Added `src/generateWishlistReview.js`.
  - Reads `data/booklist.csv`.
  - Searches catalog by title variants only.
  - Writes `data/wishlist-review.csv`.
  - Filters candidates to `dataType === common:webpac.dataType.book`.
  - Marks risky rows with `needsAttention` and `reviewNote`.
- Added `src/importWishlistReview.js`.
  - Imports only rows where `reviewDecision=add`.
  - Validates `matchStatus=matched`, book data type, and `matchedTitle`.
  - Adds/updates wishlist entries with tags `包包` and `閱讀小博士`.
  - Preserves catalog fields: `bookId`, `author`, `imprint`, `dataType`, `holdings`, `available`, `reservable`, `waitingCount`.
- Updated `.gitignore` to ignore generated `data/` and `scripts/` artifacts.
- Imported reviewed rows locally and synced wishlist data to Cloudflare KV.
- Verified KV readback:
  - Wishlist total: 441.
  - Items tagged `閱讀小博士`: 225.
  - Sample verified item: `動物絕對不應該穿衣服`.
- Added `閱讀小博士` to favorites tags and synced tags to Cloudflare KV so the UI can show the filter.
- Updated README with wishlist review usage, notification behavior, feature log, and roadmap.

## Validation

- `npm test`
  - 72 tests passed.
- `node src/importWishlistReview.js`
  - `importedRows`: 227
  - `skippedAddRows`: 0
  - `added`: 0
  - `updated`: 227
  - `skipped`: 0
- Cloudflare KV readback confirmed the synced wishlist contains 225 `閱讀小博士` items.

## Notification Rules

- Daily automatic refresh at 10:00 Taiwan time:
  - Scrape account data.
  - Push library data and history to Cloudflare KV.
  - Send LINE push and Email, even when there are no alerts.
- Browser actions:
  - Browser refresh scrapes and writes KV, then displays status only in the browser.
  - Browser renew/reserve results display only in the browser.
  - Successful browser renew/reserve starts a non-notifying refresh to sync KV.
- LINE actions:
  - LINE refresh/daily/renew actions display only in LINE.
  - LINE-triggered refresh and successful renew flows still update KV.
  - LINE actions do not send Email.
- Manual GitHub workflow runs:
  - Default to LINE-only notification.
  - Do not send Email.

## Confirmed Rules

- Search only by the CSV `書名` column.
- Do not use `級別` as a search keyword.
- Keep `級別` in the review output as source metadata.
- After catalog search results are returned, filter candidates first:
  - Only `dataType === common:webpac.dataType.book` can be selected as a match.
  - Electronic resources, AV materials, and all other non-book results must be excluded before picking the best match.
- All rows require manual review.
- Use `needsAttention` and `reviewNote` to call out rows that especially need attention.
- Wishlist tags for imported rows: `包包`, `閱讀小博士`.

## Review CSV Shape

Write `data/wishlist-review.csv` with these columns:

- `編號`
- `原始書名`
- `級別`
- `searchKeywords`
- `matchStatus`
- `matchedTitle`
- `bookId`
- `author`
- `imprint`
- `dataType`
- `holdings`
- `available`
- `reservable`
- `waitingCount`
- `reviewDecision`
- `needsAttention`
- `reviewNote`

`reviewDecision` should be blank initially. The user will fill it later, using:

- `add`: add this matched book to the wishlist.
- blank or `skip`: do not add.

## Match Statuses

Use these statuses:

- `matched`: a book candidate matched the source title.
- `not_found`: catalog search returned no results.
- `no_book_candidate`: search returned results, but none had `dataType === common:webpac.dataType.book`.
- `no_match`: there were book candidates, but no clear title match.
- `error`: search failed for that source row.

## Matching Logic

Use title-only search with a small set of title variants:

- Original title as-is.
- Title with punctuation removed when useful.

Normalize for comparison by ignoring:

- Common punctuation and spaces.
- Full-width vs half-width question/comma style differences.
- Parenthetical content.
- Common edition strings such as `新版`, `初心版`, `初版`.
- `您` vs `你`.

Candidate selection:

1. Search catalog by title.
2. Merge unique results by `bookId`.
3. Filter to `dataType === common:webpac.dataType.book`.
4. Score only book candidates.
5. Prefer exact normalized title match.
6. For ties, prefer fewer waiters, then more holdings.

Short titles are risky. If a short title has multiple exact same-title book candidates, still output the best candidate, but set:

- `needsAttention=true`
- `reviewNote` includes: `短書名且有多個完全同名圖書候選，需人工確認版本/作者`

## Review Notes

Populate `reviewNote` with useful reasons, separated by semicolons if multiple apply:

- `找不到任何搜尋結果`
- `搜尋結果全部不是圖書類別，已排除電子資源/視聽資料`
- `有圖書候選，但書名標準化後無明確匹配`
- `短書名且有多個完全同名圖書候選，需人工確認版本/作者`
- `最佳候選不是完全同名，只是標準化/包含比對相符`
- `另排除 N 筆非圖書結果`
- Already owned or skipped reasons, if checked:
  - `已在願望清單`
  - `目前借閱中`
  - `已在預約清單`
  - `借閱史已有`

## Next Step

- Run full tests before future refactors: `npm test`.
- Consider moving the review/import flow into the UI.
- Consider making `/api/wishlist` tags merge from wishlist data as well as favorites data, so future wishlist-only tags appear automatically.
- Consider adding tests for `generateWishlistReview.js` parsing/matching helpers and `importWishlistReview.js` row filtering.
