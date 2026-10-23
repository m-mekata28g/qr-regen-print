/**
 * 物流管理支援システム - Cloudflare Worker / D1
 *
 * ・GET  /api/health   D1接続確認（認証なし）
 * ・POST /api/sync     端末の変更分をD1へ保存（要トークン）
 * ・GET  /api/records  D1の内容を取得（要トークン。?summary=1 で件数のみ）
 * ・上記以外は、公開許可リストに登録した静的ファイルだけを配信
 *
 * 画面側は今まで通り localStorage に保存し、そのあとD1にも保存します。
 * D1への保存に失敗しても、画面の動作・localStorageへの保存には影響しません。
 *
 * 必要な設定（Cloudflareのシークレット）:
 *   npx wrangler secret put API_TOKEN
 */

const PUBLIC_FILES = new Set([
  "/",
  "/index.html",
  "/sw.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
]);

const MAX_UPSERTS = 100;      // 1回のリクエストで保存できるレコード数
const MAX_DELETES = 5000;     // 1回のリクエストで削除（論理）できるID数
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LIST = 5000;

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const str = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v, max = 100) => (typeof v === "string" && v ? v.slice(0, max) : null);

/** トークンの照合（長さや内容の違いが処理時間に出ないよう、ハッシュ同士を比較） */
async function isAuthorized(request, env) {
  const expected = env.API_TOKEN;
  if (!expected) return "not_configured";

  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected))
  ]);
  return crypto.subtle.timingSafeEqual(a, b) ? "ok" : "unauthorized";
}

async function requireAuth(request, env) {
  const r = await isAuthorized(request, env);
  if (r === "ok") return null;
  if (r === "not_configured") {
    return json({ ok: false, error: "サーバー側にAPI_TOKENが設定されていません。" }, 503);
  }
  return json({ ok: false, error: "トークンが正しくありません。" }, 401);
}

const UPSERT_SQL = `
INSERT INTO qr_records
  (id, qr_key, url, delivery_date, main_name, hall, product, status,
   assignment_completed, created_at, scanned_at, sent_at, printed_at,
   print_batch_id, deleted_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
ON CONFLICT(id) DO UPDATE SET
  qr_key = excluded.qr_key,
  url = excluded.url,
  delivery_date = excluded.delivery_date,
  main_name = excluded.main_name,
  hall = excluded.hall,
  product = excluded.product,
  status = excluded.status,
  assignment_completed = excluded.assignment_completed,
  created_at = excluded.created_at,
  scanned_at = excluded.scanned_at,
  sent_at = excluded.sent_at,
  printed_at = excluded.printed_at,
  print_batch_id = excluded.print_batch_id,
  deleted_at = NULL,
  updated_at = excluded.updated_at`;

async function handleSync(request, env) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY_BYTES) return json({ ok: false, error: "リクエストが大きすぎます。" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "JSONを読み取れませんでした。" }, 400);
  }

  const upserts = Array.isArray(body.upserts) ? body.upserts : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  const halls = Array.isArray(body.halls) ? body.halls : null;       // null = 変更なし
  const products = Array.isArray(body.products) ? body.products : null;

  if (upserts.length > MAX_UPSERTS) {
    return json({ ok: false, error: `一度に保存できるのは${MAX_UPSERTS}件までです。` }, 400);
  }
  if (deletes.length > MAX_DELETES) {
    return json({ ok: false, error: `一度に削除できるのは${MAX_DELETES}件までです。` }, 400);
  }

  const now = new Date().toISOString();
  const stmts = [];

  for (const r of upserts) {
    const id = str(r?.id, 100);
    const url = str(r?.url, 4000);
    if (!id || !url) return json({ ok: false, error: "id または url のないレコードがあります。" }, 400);

    stmts.push(
      env.DB.prepare(UPSERT_SQL).bind(
        id,
        str(r.qrKey, 4100) || "qr:" + url,
        url,
        str(r.date, 20),
        str(r.mainName, 200),
        str(r.hall, 200),
        str(r.product, 200),
        r.status === "printed" ? "printed" : "unprinted",
        r.assignmentCompleted === true ? 1 : 0,
        strOrNull(r.createdAt),
        strOrNull(r.scannedAt),
        strOrNull(r.sentAt),
        strOrNull(r.printedAt),
        strOrNull(r.printBatchId),
        now
      )
    );
  }

  // 削除は論理削除（行は残し deleted_at を入れる）
  const delIds = deletes.filter((x) => typeof x === "string" && x && x.length <= 100);
  if (delIds.length) {
    stmts.push(
      env.DB.prepare(
        `UPDATE qr_records SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`
      ).bind(now, now, JSON.stringify(delIds))
    );
  }

  // ホールマスタは全置き換え（画面側で変更があったときだけ送られてくる）
  if (halls) {
    const rows = halls
      .map((h) => ({ main: str(h?.main, 200).trim(), hall: str(h?.hall, 200).trim() }))
      .filter((h) => h.main && h.hall)
      .slice(0, 1000);
    stmts.push(env.DB.prepare("DELETE FROM halls"));
    rows.forEach((h, i) => {
      stmts.push(
        env.DB.prepare("INSERT INTO halls (position, main_name, hall) VALUES (?, ?, ?)").bind(i, h.main, h.hall)
      );
    });
  }

  // 商品名は追加のみ（消さない）
  if (products) {
    products
      .map((p) => str(p, 200).trim())
      .filter(Boolean)
      .slice(0, 2000)
      .forEach((p) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO products (name) VALUES (?)").bind(p)));
  }

  if (!stmts.length) return json({ ok: true, saved: 0, deleted: 0 });

  try {
    await env.DB.batch(stmts); // まとめて1つのトランザクションとして実行
  } catch (error) {
    return json(
      { ok: false, error: "D1への保存に失敗しました。", detail: error instanceof Error ? error.message : String(error) },
      500
    );
  }

  return json({ ok: true, saved: upserts.length, deleted: delIds.length });
}

async function handleRecords(request, env, url) {
  try {
    const counts = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'unprinted' THEN 1 ELSE 0 END) AS unprinted,
              SUM(CASE WHEN status = 'printed' THEN 1 ELSE 0 END) AS printed
       FROM qr_records WHERE deleted_at IS NULL`
    ).first();

    const summary = {
      total: counts?.total ?? 0,
      unprinted: counts?.unprinted ?? 0,
      printed: counts?.printed ?? 0
    };

    if (url.searchParams.get("summary") === "1") return json({ ok: true, counts: summary });

    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "1000", 10) || 1000, 1), MAX_LIST);
    const { results } = await env.DB.prepare(
      `SELECT * FROM qr_records WHERE deleted_at IS NULL ORDER BY created_at DESC, id LIMIT ?`
    ).bind(limit).all();
    const halls = (await env.DB.prepare("SELECT main_name, hall FROM halls ORDER BY position").all()).results;
    const products = (await env.DB.prepare("SELECT name FROM products ORDER BY name").all()).results;

    return json({ ok: true, counts: summary, records: results, halls, products });
  } catch (error) {
    return json(
      { ok: false, error: "D1の読み取りに失敗しました。", detail: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path;

    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // D1接続確認API（認証なし。接続の可否だけを返す）
    if (path === "/api/health" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS connected").first();
        return json({
          ok: true,
          d1: result?.connected === 1 ? "connected" : "unknown",
          database: "qr-regen-print-db"
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: "D1への接続に失敗しました。",
            detail: error instanceof Error ? error.message : String(error)
          },
          500
        );
      }
    }

    // データ保存・取得API（トークン必須）
    if (path === "/api/sync" || path === "/api/records") {
      const expected = path === "/api/sync" ? "POST" : "GET";
      if (request.method !== expected) {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: expected } });
      }
      const denied = await requireAuth(request, env);
      if (denied) return denied;
      return path === "/api/sync" ? handleSync(request, env) : handleRecords(request, env, url);
    }

    // 登録されていないファイルは配信しない
    if (!PUBLIC_FILES.has(path)) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // URLは書き換えず、Cloudflareの静的ファイル配信にそのまま任せる。
    // （"/" → "/index.html" の書き換えは、Cloudflare側の
    //   "/index.html" → "/" 自動転送とぶつかり、リダイレクトループになる）
    return env.ASSETS.fetch(request);
  }
};
