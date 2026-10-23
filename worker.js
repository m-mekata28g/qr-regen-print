/**
 * 物流管理支援システム - Cloudflare Worker / D1接続確認用
 * リポジトリ直下にWebサイトのファイルを置く構成向け。
 *
 * 現段階では GET /api/health によるD1接続確認と、
 * 公開許可リストに登録した静的ファイルの配信を行います。
 * localStorage から D1 へのデータ保存切り替えは未実装です。
 */

const PUBLIC_FILES = new Set([
  "/",
  "/index.html",
  "/sw.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path;

    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // D1接続確認API
    if (path === "/api/health" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS connected").first();

        return Response.json({
          ok: true,
          d1: result?.connected === 1 ? "connected" : "unknown",
          database: "qr-regen-print-db"
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: "D1への接続に失敗しました。",
            detail: error instanceof Error ? error.message : String(error)
          },
          { status: 500 }
        );
      }
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
