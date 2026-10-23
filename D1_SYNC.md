# D1への保存（データのサーバーバックアップ）

画面のデータを、今まで通りブラウザ（localStorage）に保存したうえで、Cloudflare D1 にも保存する仕組みの説明です。

- データの項目：[DATA_DESIGN.md](DATA_DESIGN.md)
- 構成・デプロイ：[DEPLOYMENT.md](DEPLOYMENT.md)

## 1. 考え方

| 項目 | 内容 |
|---|---|
| 主な保存先 | 今まで通り、ブラウザの localStorage（画面はここを読み書きする） |
| D1の役割 | localStorage の内容のコピー（バックアップ）。画面はD1を読まない |
| 送るタイミング | `save()` のたび（約1.5秒まとめて）、設定の保存時、通信が戻ったとき |
| 送る内容 | 前回送った内容との差分（追加・変更・削除）だけ |
| 失敗したとき | 画面とlocalStorageは影響を受けない。通信が戻ると自動で再送する |
| 未設定のとき | 何も送らない。今までと同じ動作 |

QRコード画像（`image`）はD1に保存しません。`url` から再生成できるためです。

## 2. セキュリティ

アプリのURLは誰でも開けるため、D1へのAPIは**トークン必須**にしています。

- Worker のシークレット `API_TOKEN` と、画面の「D1保存用トークン」が一致したときだけ保存・取得できます。
- 画面のトークンは、その端末のlocalStorage（`logistics_d1_cfg`）にだけ保存します。バックアップのJSONには含めません。
- `/api/health` だけは、接続の可否を返すため認証なしです。

## 3. D1のテーブル

`migrations/0001_init.sql` で作成します。

| テーブル | 内容 |
|---|---|
| `qr_records` | QRレコード。`id` がUUIDの主キー。`deleted_at` が入っている行は削除済み（論理削除） |
| `halls` | 本社名 / ホール名マスタ（変更があったとき、全体を置き換え） |
| `products` | 商品名の候補（追加のみ。削除しない） |

### `qr_records` の項目と、画面の項目との対応

| D1の列 | 画面の項目 |
|---|---|
| `id` | `id` |
| `qr_key` | `qrKey` |
| `url` | `url` |
| `delivery_date` | `date` |
| `main_name` | `mainName` |
| `hall` | `hall` |
| `product` | `product` |
| `status` | `status` |
| `assignment_completed` | `assignmentCompleted`（0 / 1） |
| `created_at` / `scanned_at` / `sent_at` / `printed_at` | `createdAt` / `scannedAt` / `sentAt` / `printedAt` |
| `print_batch_id` | `printBatchId` |

`image` は保存しません。

## 4. API

| メソッド・パス | 認証 | 内容 |
|---|---|---|
| `GET /api/health` | 不要 | D1の接続確認 |
| `POST /api/sync` | 必要 | `{upserts, deletes, halls?, products?}` を保存。1回につき `upserts` は100件まで |
| `GET /api/records` | 必要 | D1の内容を返す。`?summary=1` で件数のみ、`?limit=` で件数を指定（最大5,000） |

認証は `Authorization: Bearer <トークン>` です。

## 5. 導入手順

1. **テーブルを作る**（初回のみ）
   ```
   npx wrangler d1 migrations apply qr-regen-print-db --remote
   ```
   コマンドを使わない場合は、Cloudflareのダッシュボードで D1 → 対象のデータベース → Console を開き、`migrations/0001_init.sql` の内容を貼り付けて実行します。
2. **トークンを決めて、Workerのシークレットに登録する**
   ```
   npx wrangler secret put API_TOKEN
   ```
   ダッシュボードの場合は、Workers → 対象のWorker → Settings → Variables and Secrets で、種類を「Secret」にして `API_TOKEN` を追加します。長くて推測されにくい文字列にしてください。
3. **ファイルを反映する**（`worker.js` / `index.html` / `sw.js` / `migrations/`）。
4. **各端末で設定する**：設定画面の「D1保存用トークン」に同じトークンを入れ、「D1設定を保存」を押します。スマホとPCの両方で行います。
5. **確認する**：「D1の件数を確認」を押し、D1の件数が表示されることを確認します。

## 6. 運用上の注意

- スマホとPCは、これまで通り別々のデータです（画面はD1から読み込みません）。D1の `qr_records` には、両方の端末のレコードが集まります。
- 画面で削除したQRは、D1では `deleted_at` が入るだけで、行は残ります。誤って削除した場合は、D1から復元できます。
- 同じ端末のlocalStorageを消去（またはブラウザを変更）すると、「前回送った内容」の記録も消えます。そのときは、次の保存時に全件を送り直すだけで、D1のデータは壊れません。
- 「今すぐD1に保存」は、全件を送り直します。何度押しても結果は同じです。
- D1からの読み込み（復元）は、まだ画面に実装していません。
