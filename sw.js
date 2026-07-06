self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // 自身のサーバーへの通信はスルー
    if (requestUrl.startsWith(self.location.origin)) return;

    if (event.request.method === 'GET') {
        const destination = event.request.destination;

        // 💡 【学校の規制突破の核心】ページ全体の移動（document）を検知した場合
        if (destination === 'document') {
            event.respondWith(
                self.clients.matchAll().then(clients => {
                    if (clients && clients.length) {
                        // 親画面（index.html）に対して「ユーザーがこのURLに移動しようとしたよ」と通知
                        clients[0].postMessage({
                            type: 'js-navigate',
                            url: requestUrl
                        });
                    }
                    // 💡 本物のサイトには行かせず、自サーバー内の安全な偽ページを返して通信を遮断する
                    return new Response(
                        `<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;">
                            <div>Loading via Secure Proxy...</div>
                         </body></html>`, 
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                })
            );
            return;
        }

        // --- その他の画像、JS、CSS等のプロキシ処理 ---
        let proxyEndpoint = '/proxy-media'; 
        if (destination === 'image') {
            proxyEndpoint = '/proxy-image';
        } else if (destination === 'script' || destination === 'style' || destination === '') {
            proxyEndpoint = '/proxy-fetch'; 
        }

        const proxyUrl = `${self.location.origin}${proxyEndpoint}?url=${encodeURIComponent(requestUrl)}`;
        
        event.respondWith(
            fetch(proxyUrl, {
                method: 'GET',
                headers: new Headers(event.request.headers),
                credentials: 'omit'
            })
        );
    }
});
