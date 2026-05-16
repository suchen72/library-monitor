# Closeout: Notification Routing, Wishlist Review, and Account Sync

## Status

This work is closed out and pushed to `main`.

Completed areas:

- Notification routing is split by trigger source.
- CSV booklist wishlist review/import flow is documented and implemented.
- Wishlist `閱讀小博士` tagging is synced and visible in borrowed/reservation views.
- New-account visibility is hardened for local server, Cloudflare KV reads, and GitHub Actions.
- New-account setup SOP is documented in `README.md`.

## Validation

- `npm test`
  - 76 tests passed.
- Manual GitHub Actions workflow run was tested by the user and produced the expected result.
- Cloudflare KV readback confirmed `account4:Daniel` is present after sync.
- Wishlist KV readback previously confirmed:
  - Wishlist total: 441.
  - Items tagged `閱讀小博士`: 225.
  - Sample verified item: `動物絕對不應該穿衣服`.

## Notification Rules

- Daily automatic refresh runs at 10:17 Taiwan time in GitHub Actions and local `node-cron`.
- Scheduled daily refresh:
  - Scrapes account data.
  - Pushes library data and history to Cloudflare KV.
  - Sends both LINE push and Email, even when there are no alerts.
- Browser actions:
  - Browser refresh writes Cloudflare KV and reports only in the browser.
  - Browser renew/reserve results display only in the browser.
  - Successful browser renew/reserve starts a non-notifying refresh to sync KV.
- LINE actions:
  - LINE refresh/daily/renew actions display only in LINE.
  - LINE-triggered refresh and successful renew flows still update KV.
  - LINE actions do not send Email.
- Manual GitHub workflow runs:
  - Default to `source=manual`.
  - Report to LINE only.
  - Do not send Email.

## Wishlist Review Rules

- Search only by the CSV `書名` column.
- Do not use `級別` as a search keyword.
- Keep `級別` in the review output as source metadata.
- Filter candidates before matching:
  - Only `dataType === common:webpac.dataType.book` can be selected.
  - Electronic resources, AV materials, and other non-book results are excluded.
- All rows require manual review.
- Use `needsAttention` and `reviewNote` for risky rows.
- Imported wishlist rows use tags `包包` and `閱讀小博士`.

## Review CSV Shape

`data/wishlist-review.csv` columns:

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

`reviewDecision` values:

- `add`: add this matched book to the wishlist.
- blank or `skip`: do not add.

## Match Statuses

- `matched`: a book candidate matched the source title.
- `not_found`: catalog search returned no results.
- `no_book_candidate`: search returned results, but none had `dataType === common:webpac.dataType.book`.
- `no_match`: there were book candidates, but no clear title match.
- `error`: search failed for that source row.

## Matching Logic

Use title-only search with a small set of variants:

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

Short titles are risky. If a short title has multiple exact same-title book candidates, output the best candidate but set:

- `needsAttention=true`
- `reviewNote` includes `短書名且有多個完全同名圖書候選，需人工確認版本/作者`

## New Account SOP

The canonical SOP is in `README.md` under `新增帳號 SOP`.

Key requirements:

- Add `ACCOUNTn_LABEL`, `ACCOUNTn_CARD`, and `ACCOUNTn_PASSWORD` locally in `.env`.
- Add the same names to GitHub repository secrets under:
  - `Settings` -> `Secrets and variables` -> `Actions` -> `Repository secrets`
- Run `Library Scrape & Notify` manually once after adding a new account.
- Confirm the new account appears in the dashboard or Cloudflare KV readback.

The workflow currently exposes `ACCOUNT1_*` through `ACCOUNT10_*`; account loading scans all configured `ACCOUNTn_CARD` values and no longer stops at the first missing number.

## Future Work

- Move the wishlist review/import flow into the UI.
- Auto-sync Cloudflare KV after wishlist review import, with retryable failure messaging.
- Make `/api/wishlist` tags merge from wishlist data as well as favorites data.
- Add tests for `generateWishlistReview.js` parsing/matching helpers and `importWishlistReview.js` row filtering.
