// sw.js - iframe内の通信をすべて横取りするスクリプト

self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// --- sw.js の内部を修正 ---
self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    if (requestUrl.startsWith(self.location.origin)) return;

    if (event.request.method === 'GET') {
        const destination = event.request.destination;
        let proxyEndpoint = '/proxy-media'; // デフォルト（動画・音声・その他アセット用）

        if (destination === 'image') {
            proxyEndpoint = '/proxy-image';
        } else if (destination === 'script' || destination === 'style' || destination === '') {
            // 💡 改良: 新設した軽量プロキシを指定
            proxyEndpoint = '/proxy-fetch'; 
        }

        const proxyUrl = `${self.location.origin}${proxyEndpoint}?url=${encodeURIComponent(requestUrl)}`;
        
        // 💡 改良: headersオブジェクトを新しく安全に複製（セキュリティエラー対策）
        const newHeaders = new Headers(event.request.headers);
        
        event.respondWith(
            fetch(proxyUrl, {
                method: 'GET',
                headers: newHeaders,
                credentials: 'omit' // サンドボックス内でのクッキー競合を避ける設定
            })
        );
    }
});
