// sw.js - iframe内の通信をすべて横取りするスクリプト

self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // 自身のプロキシサーバーへの通信は無限ループになるのでスルー
    if (requestUrl.startsWith(self.location.origin)) return;

    // GETリクエストのみを対象にする
    if (event.request.method === 'GET') {
        const destination = event.request.destination;
        let proxyEndpoint = '/proxy-media'; // 基本はメディア・その他用プロキシ

        if (destination === 'image') {
            // 画像は専用プロキシへ
            proxyEndpoint = '/proxy-image';
        } else if (destination === 'script' || destination === 'style' || destination === '') {
            // JS、CSS、およびフロントからのfetch/XHR通信(destinationが空文字)の場合
            // ※server.jsの /proxy-media がStream形式でAPI通信を壊す場合は、
            //  通常のテキスト/JSONを返す軽量な「/proxy-fetch」等をserver.js側に別途作るのが理想です
            proxyEndpoint = '/proxy-media'; 
        }

        const proxyUrl = `${self.location.origin}${proxyEndpoint}?url=${encodeURIComponent(requestUrl)}`;
        
        event.respondWith(
            fetch(proxyUrl, {
                headers: event.request.headers
            })
        );
    }
    
    //  メモ: POSTリクエストなどの場合は、現時点ではそのままスルーされます。
    // 将来的にformのPOSTやAPIのPOSTをデバッグしたい場合は、ここにロジックを追加します。
});
