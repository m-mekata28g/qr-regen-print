/**
 * 物流システム v6.0 - URL一覧のGmail転送用 Google Apps Script
 *
 * 受信データ:
 * { token, to, date, batchId, urls: ["https://...", ...] }
 *
 * デプロイ設定:
 *   実行するユーザー: 自分
 *   アクセスできるユーザー: 全員
 *
 * 【初回／更新時の手順】
 * 1. このコードを貼り付けて、TRANSFER_TOKEN と DEFAULT_TO を自分の値に書き換えて保存
 * 2. 関数 authorizeOnce を選んで「実行」→ 権限を承認（テストメールが届きます）
 * 3. デプロイ → デプロイを管理 → 編集（鉛筆）→ バージョン「新しいバージョン」→ デプロイ
 * 4. アプリの「設定」→「GAS接続テスト」で「接続OK：... v6.0 ...」と出れば完了
 *
 * ※ GitHubなどに公開する場合は、TRANSFER_TOKEN と DEFAULT_TO を必ずダミーの値にしてください。
 */

const VERSION = 'v6.0';

const CONFIG = {
  TRANSFER_TOKEN: '*****',
  DEFAULT_TO: 'example@gmail.com',
  SUBJECT_PREFIX: 'URLファイル'
};

function doGet() {
  return ContentService.createTextOutput(
    'logistics-system ' + VERSION + ' URL transfer endpoint is running.'
  );
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return out_({ ok: false, error: 'empty request' });
    }

    const payload = JSON.parse(e.postData.contents);

    if (payload.token !== CONFIG.TRANSFER_TOKEN) {
      return out_({ ok: false, error: 'unauthorized' });
    }

    const to = String(payload.to || CONFIG.DEFAULT_TO).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return out_({ ok: false, error: 'invalid recipient' });
    }

    if (!Array.isArray(payload.urls) || payload.urls.length === 0) {
      return out_({ ok: false, error: 'no urls' });
    }

    const urls = payload.urls
      .map(function (url) { return String(url).trim(); })
      .filter(function (url) { return /^https?:\/\/\S+$/i.test(url); });

    if (urls.length === 0) {
      return out_({ ok: false, error: 'no valid URLs' });
    }

    const tz = 'Asia/Tokyo';
    const now = new Date();
    const date = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const time = Utilities.formatDate(now, tz, 'HH-mm-ss');
    const batchId = String(payload.batchId || '');

    // 1行につき1URLのテキストファイル（ファイル名に送信時刻を含める）
    const attachment = Utilities.newBlob(
      urls.join('\n') + '\n',
      'text/plain',
      'URL一覧_' + date + '_' + time + '.txt'
    );

    const subject = CONFIG.SUBJECT_PREFIX + ' ' + date + ' ' + time.replace(/-/g, ':') + ' (' + urls.length + '件)';
    const body = [
      '物流システムからURL一覧を受信しました。',
      '',
      '送信日時: ' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
      '件数: ' + urls.length + '件',
      'バッチID: ' + batchId,
      '',
      '添付されたTXTファイルをPCに読み込んでください。'
    ].join('\n');

    // MailApp は GmailApp より必要な権限が少なく、承認の失敗が起きにくい
    MailApp.sendEmail(to, subject, body, {
      attachments: [attachment],
      name: '物流システム'
    });

    return out_({
      ok: true,
      count: urls.length,
      batchId: batchId,
      version: VERSION,
      remainingQuota: MailApp.getRemainingDailyQuota()
    });

  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return out_({ ok: false, error: String(err) });
  }
}

/** エディタから1回だけ手動実行して、メール送信権限を承認するための関数 */
function authorizeOnce() {
  MailApp.sendEmail(
    CONFIG.DEFAULT_TO,
    '物流システム GAS 承認テスト',
    '権限の承認に成功しました。(' + VERSION + ')'
  );
}

function out_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
