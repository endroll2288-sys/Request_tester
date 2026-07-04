
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 自分のサーバーの内部通信（index.htmlやsw.js自体）はスルー
    if (url.origin === self.location.origin && !url.pathname.startsWith('/wrapped-proxy')) {
        return;
    }

    // iframe内で発生した外部サイトへのFetchをすべて捕まえる
    let targetUrl = req.url;
    
    // もしすでにプロキシURLになっていたら、元のURLを抽出する
    if (url.pathname.startsWith('/proxy')) {
        return; // 無限ループ防止
    }

    // サーバーのマルチメディア/汎用プロキシへリダイレクト
    const proxyUrl = `${self.location.origin}/proxy-media?url=${encodeURIComponent(targetUrl)}`;

    // 元のリクエストのヘッダーやメソッド（POSTなど）をコピーして中継
    const modifiedRequest = new Request(proxyUrl, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : null,
        referrer: req.referrer,
        mode: 'cors', // CORS制約を回避
        credentials: 'omit'
    });

    event.respondWith(fetch(modifiedRequest));
});
