/**
 * 物流管理支援システム - Cloudflare Worker / D1接続確認用
 *
 * 現段階ではD1への接続確認APIを提供します。
 * 既存HTMLのlocalStorage保存をD1保存へ切り替える処理は、別途実装が必要です。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // D1接続確認: GET /api/health
    if (url.pathname === "/api/health" && request.method === "GET") {
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

    // API以外のURLは静的ファイルとして配信
    return env.ASSETS.fetch(request);
  }
};
