self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // 💡 【修正点1】プロキシ用のエンドポイント（自分自身へのリクエスト）はインターセプトせずスルーする
    if (requestUrl.includes('/proxy-html') || 
        requestUrl.includes('/proxy-image') || 
        requestUrl.includes('/proxy-media') || 
        requestUrl.includes('/proxy-fetch') ||
        requestUrl.includes('/sw.js')) {
        return; 
    }

    // 💡 自身のサーバーのルート（index.htmlなど）への直接アクセスもスルー
    if (requestUrl === self.location.origin + '/' || requestUrl === self.location.origin) {
        return;
    }

    const destination = event.request.destination;

    // 💡 【ドキュメント遷移の横取り】ページ全体の移動（リンククリックやJSによるリダイレクト）を検知
    if (destination === 'document' && event.request.method === 'GET') {
        event.respondWith(
            self.clients.matchAll().then(clients => {
                if (clients && clients.length) {
                    // 親画面（index.html）に対して「このURLに移動しようとした」と通知し、親側でプロキシURLを再ロードさせる
                    clients[0].postMessage({
                        type: 'js-navigate',
                        url: requestUrl
                    });
                }
                // 本物のサイトには直接行かせず、ローディング画面を一時的に返して遷移をブロック
                return new Response(
                    `<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                        <div style="text-align:center;">
                            <div style="font-size:18px;margin-bottom:10px;">Loading via Secure Proxy...</div>
                            <div style="font-size:12px;color:#888;">Redirecting safely...</div>
                        </div>
                     </body></html>`, 
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                );
            })
        );
        return;
    }

    // --- その他の画像、JS、CSS、API（Fetch/XHR）等の子リクエストのプロキシ処理 ---
    let proxyEndpoint = '/proxy-media'; 
    if (destination === 'image') {
        proxyEndpoint = '/proxy-image';
    } else if (destination === 'script' || destination === 'style' || destination === '' || destination === 'manifest') {
        proxyEndpoint = '/proxy-fetch'; 
    }

    // プロキシ宛てのURLを構築
    const proxyUrl = `${self.location.origin}${proxyEndpoint}?url=${encodeURIComponent(requestUrl)}`;
    
    // 💡 【修正点2】GET だけでなく POST / PUT などのあらゆるメソッドに対応
    const fetchOptions = {
        method: event.request.method,
        credentials: 'omit'
    };

    // GET/HEAD 以外の場合は、リクエストのBody（中身）をクローンしてバックエンドに引き渡す
    if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
        fetchOptions.body = event.request.clone().body;
    }

    event.respondWith(
        fetch(proxyUrl, fetchOptions).catch(err => {
            console.error('SW Fetch Error:', err);
            // オフラインやエラー時のフォールバック（壊れた画像を返さないための対策）
            if (destination === 'image') {
                return new Response(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#eee"/></svg>`,
                    { headers: { 'Content-Type': 'image/svg+xml' } }
                );
            }
            return new Response(`Proxy Connection Failed`, { status: 502, statusText: 'Bad Gateway' });
        })
    );
});
