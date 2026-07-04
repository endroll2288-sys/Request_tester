// sw.js - iframe内の通信をすべて横取りするスクリプト

// サービスワーカーがインストールされたらすぐにアクティブにする
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// 🔥 ここが核心：iframe内のあらゆるリクエストを横取りする
self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // 自分のサーバー（localhostやonrender.com）宛ての通信は横取りしない（無限ループ防止）
    if (requestUrl.startsWith(self.location.origin)) {
        return;
    }

    // 外部への通信（API、画像、JSなど）であれば、すべて自分のサーバーのプロキシ宛てに書き換える
    // ※今回はGET通信をメインに中継する例です
    if (event.request.method === 'GET') {
        const proxyUrl = `${self.location.origin}/proxy-media?url=${encodeURIComponent(requestUrl)}`;
        
        event.respondWith(
            fetch(proxyUrl, {
                headers: event.request.headers
            })
        );
    }
});
