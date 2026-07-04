// sw.js - iframe内の通信をすべて横取りするスクリプト

self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // 自身のプロキシサーバーへの通信はスルー
    if (requestUrl.startsWith(self.location.origin)) return;

    const destination = event.request.destination;
    let proxyEndpoint = '/proxy-media'; // デフォルト

    if (destination === 'image') {
        proxyEndpoint = '/proxy-image';
    } else if (destination === 'script' || destination === 'style') {
        // スクリプトやCSSも必要に応じて個別プロキシにするか、メインプロキシへ
        proxyEndpoint = '/proxy'; 
    }

    // GETリクエストの転送ロジック
    if (event.request.method === 'GET') {
        const proxyUrl = `${self.location.origin}${proxyEndpoint}?url=${encodeURIComponent(requestUrl)}`;
        
        event.respondWith(
            fetch(proxyUrl, {
                headers: event.request.headers
            })
        );
    }
    // POSTなどの場合は、Bodyを一度リライティングしてメインプロキシ(/proxy)へ中継するロジックが必要
});
