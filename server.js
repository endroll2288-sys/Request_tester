import express from 'express';
import axios from 'axios';
import cors from 'cors';
import path from "path";
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json());
app.use(cors());

// --- 💡 [位置調整] CSS内のurl()を絶対パスに書き換えるヘルパー関数 ---
function rewriteCssUrls(cssText, baseUrl) {
    return cssText.replace(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, urlPath) => {
        const trimmedUrl = urlPath.trim();
        if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://') || trimmedUrl.startsWith('//') || trimmedUrl.startsWith('data:')) {
            return match;
        }
        try {
            const absoluteUrl = new URL(trimmedUrl, baseUrl).href;
            return `url(${quote}${absoluteUrl}${quote})`;
        } catch (e) {
            return match;
        }
    });
}

// メイン画面の配信
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// メインのプロキシ用エンドポイント
app.post('/proxy', async (req, res) => {
    const { targetUrl, method, headers, body } = req.body;

    try {
        const response = await axios({
            url: targetUrl,
            method: method || 'GET',
            headers: headers || {},
            data: body || undefined,
            responseType: 'text', 
            validateStatus: () => true
        });

        let responseData = response.data;
        const contentType = response.headers['content-type'] || '';

        if (contentType.includes('text/html') && typeof responseData === 'string') {
            const $ = cheerio.load(responseData);
            
            // 1. CSSのフェッチ & インライン化 & url()絶対パス化
            const cssPromises = [];
            $('link[rel="stylesheet"]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;

                try {
                    const absoluteCssUrl = new URL(href.trim(), targetUrl).href;
                    const fetchCss = axios.get(absoluteCssUrl, { 
                        timeout: 3000,
                        headers: headers || {} 
                    }).then(cssRes => {
                        // CSSの中身のurl()を書き換え
                        const cleanedCss = rewriteCssUrls(cssRes.data, absoluteCssUrl);
                        $(el).replaceWith(`<style>/* Inline CSS from ${href} */\n${cleanedCss}</style>`);
                    }).catch(err => {
                        console.error(`CSS fetch失敗: ${absoluteCssUrl}`, err.message);
                        $(el).attr('href', absoluteCssUrl);
                    });
                    
                    cssPromises.push(fetchCss);
                } catch (e) {}
            });
            await Promise.all(cssPromises);

            // 2. JavaScriptのフェッチ & インライン化
            const jsPromises = [];
            $('script[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (!src) return;

                if (src.includes('google') || src.includes('facebook') || src.includes('twitter') || src.includes('analytics')) {
                    return;
                }

                try {
                    const absoluteJsUrl = new URL(src.trim(), targetUrl).href;
                    const fetchJs = axios.get(absoluteJsUrl, { 
                        timeout: 3000,
                        headers: headers || {} 
                    }).then(jsRes => {
                        $(el).removeAttr('src');
                        $(el).text(`/* Inline JS from ${src} */\n${jsRes.data}`);
                    }).catch(err => {
                        console.error(`JS fetch失敗: ${absoluteJsUrl}`, err.message);
                        $(el).attr('src', absoluteJsUrl);
                    });
                    
                    jsPromises.push(fetchJs);
                } catch (e) {}
            });
            await Promise.all(jsPromises);

            // 3. HTML内の直書き <style> タグの url() も絶対パス化
            $('style').each((_, el) => {
                const rawCss = $(el).text();
                const rewrittenCss = rewriteCssUrls(rawCss, targetUrl);
                $(el).text(rewrittenCss);
            });

            // 4. [href] 属性のプロキシ化・絶対URL化
 // --- server.js の手順4の部分を確認・修正 ---
$('[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const trimmedHref = href.trim();
    if (trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:')) return;
    if (el.name === 'link' && $(el).attr('rel') === 'stylesheet') return; 

    try {
        const absoluteUrl = new URL(trimmedHref, targetUrl).href;
        if (el.name === 'a') {
            const escapedUrl = absoluteUrl.replace(/'/g, "\\'");
            // 💡 ここが正しく postMessage に書き換わっているか確認！
            $(el).attr('href', `javascript:window.parent.postMessage({type: 'navigate', url: '${escapedUrl}'}, '*'); void(0);`);
            $(el).removeAttr('target'); 
        } else {
            $(el).attr('href', absoluteUrl);
        }
    } catch (e) {}
});

            // 5. 💡 [修正] 動画・音声タグを「サーバーの動画プロキシ経由」に書き換え
            $('video, audio, source, track, embed, object').each((_, el) => {
                const attributes = ['src', 'poster', 'data'];
                attributes.forEach(attr => {
                    const value = $(el).attr(attr);
                    if (!value) return;

                    const trimmedValue = value.trim();
                    if (trimmedValue.startsWith('data:')) return;

                    try {
                        const absoluteUrl = new URL(trimmedValue, targetUrl).href;
                        // ポスター(サムネ画像)は画像プロキシ、動画・音声本体は動画ストリーミングプロキシへ通す
                        if (attr === 'poster') {
                            $(el).attr(attr, `/proxy-image?url=${encodeURIComponent(absoluteUrl)}`);
                        } else {
                            $(el).attr(attr, `/proxy-media?url=${encodeURIComponent(absoluteUrl)}`);
                        }
                    } catch (e) {}
                });
            });

            // 6. <form> タグの送信横取り用のデータ属性付与
            $('form').each((_, el) => {
                const action = $(el).attr('action') || '';
                const method = ($(el).attr('method') || 'GET').toUpperCase();

                try {
                    const absoluteActionUrl = new URL(action.trim(), targetUrl).href;
                    $(el).attr('action', absoluteActionUrl);
                    $(el).attr('data-proxy-method', method);
                    $(el).attr('data-proxy-action', absoluteActionUrl);
                    $(el).attr('onsubmit', 'return false;');
                } catch (e) {}
            });

            // 7. srcset 属性（レスポンシブ画像）の絶対URL化
            $('[srcset]').each((_, el) => {
                const srcset = $(el).attr('srcset');
                if (!srcset) return;

                const rewrittenSrcset = srcset.split(',').map(part => {
                    const match = part.trim().match(/^(\S+)(.*)$/);
                    if (!match) return part;

                    const urlPath = match[1];
                    const descriptor = match[2];

                    if (urlPath.startsWith('http://') || urlPath.startsWith('https://') || urlPath.startsWith('//') || urlPath.startsWith('data:')) {
                        return part;
                    }

                    try {
                        const absoluteUrl = new URL(urlPath, targetUrl).href;
                        return `${absoluteUrl}${descriptor}`;
                    } catch (e) {
                        return part;
                    }
                }).join(', ');

                $(el).attr('srcset', rewrittenSrcset);
            });

            // --- 
$('head').prepend(`
<script>
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            // 親画面と同じドメインにある sw.js を、このiframeのスコープとして登録
            navigator.serviceWorker.register('/sw.js', { scope: './' })
            .then(function(reg) {
                console.log('Service Worker 登録成功:', reg.scope);
            }).catch(function(err) {
                console.error('Service Worker 登録失敗:', err);
            });
        });
    }
</script>
<script>
    // window.location の変更を擬似的にキャッチするためのハック
    // ページ遷移時や、親への通知用
    window.addEventListener('DOMContentLoaded', () => {
        if (window.parent && window.parent.document.getElementById('url')) {
            // 親の入力欄に現在のURL（プロキシ対象の元URL）を同期させる
            window.parent.document.getElementById('url').value = window.location.href;
        }
    });
</script>
`);
// ---

            // 8. 通常の [src] 属性（imgなど）の絶対パス化 ＆ 画像プロキシエラーハンドラ仕込み
            $('[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (!src) return;

                const trimmedSrc = src.trim();
                if (trimmedSrc.startsWith('#') || trimmedSrc.startsWith('javascript:')) return;

                // videoやaudio、sourceタグなど、すでに手順5でプロキシURLに書き換え済みのものはスキップする
                const parentName = el.name;
                if (['video', 'audio', 'source', 'track', 'embed', 'object'].includes(parentName)) return;

                try {
                    const absoluteUrl = (!trimmedSrc.startsWith('http://') && !trimmedSrc.startsWith('https://') && !trimmedSrc.startsWith('//') && !trimmedSrc.startsWith('data:'))
                        ? new URL(trimmedSrc, targetUrl).href
                        : trimmedSrc;

                    $(el).attr('src', absoluteUrl);
                    
                    if (el.name === 'img') {
                        $(el).attr('data-original-src', absoluteUrl);
                        $(el).attr('onerror', 'window.parent.handleImageError(this)');
                    }
                } catch (e) {}
            });

            responseData = $.html();
        }

        res.json({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: responseData
        });

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).json({
            status: 500,
            statusText: 'Internal Server Error',
            headers: {},
            data: `Proxy Error: ${error.message}`
        });
    }
});

// 画像プロキシ用エンドポイント
app.get('/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
        });

        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.send(response.data);
    } catch (error) {
        console.error('Image Proxy Error:', error.message);
        res.status(500).send('Failed to fetch image');
    }
});

// 動画・音声用のストリーミングプロキシエンドポイント
app.get('/proxy-media', async (req, res) => {
    const mediaUrl = req.query.url;
    if (!mediaUrl) return res.status(400).send('URL is required');

    try {
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };
        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream', // 💡 メモリを食わないストリーミング形式
            headers: requestHeaders,
            validateStatus: () => true
        });

        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
        
        res.status(response.status);
        response.data.pipe(res);

    } catch (error) {
        console.error('Media Proxy Error:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Failed to stream media');
        }
    }
});


// --- server.js に追加 ---
// JavaScript（Fetch/XHR）専用のプロキシエンドポイント
app.get('/proxy-fetch', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            url: targetUrl,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                // 必要に応じて親から引き継いだヘッダーをここに展開
            },
            responseType: 'text', // JSONやテキストを安全に受けるためにtext型に指定
            validateStatus: () => true
        });

        // ターゲットから返ってきたContent-Typeをそのままブラウザに返す（jsonやjavascriptなど）
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        res.status(response.status).send(response.data);

    } catch (error) {
        console.error('Fetch Proxy Error:', error.message);
        res.status(500).send(`Fetch Proxy Error: ${error.message}`);
    }
});

// --- server.js に追加 ---
// iframeの src に直接指定するためのHTML配信用プロキシ
// --- server.js に追加・上書き ---
// --- server.js の /proxy-html を検索エンジン対応版に上書き ---
app.get('/proxy-html', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    // HTTPやHTTPSが抜けている場合の自動補完 (例: google.com -> https://google.com)
    if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
    }

    try {
        const response = await axios({
            url: targetUrl,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
            },
            responseType: 'text',
            maxRedirects: 5, // 💡 自動でリダイレクト（画面切り替え）を追いかける
            validateStatus: (status) => status >= 200 && status < 400 // 302なども許容する
        });

        // 💡 実際に最終到達したURL（リダイレクト後）を基準URLにする
        const finalTargetUrl = response.config.url || targetUrl;
        let responseData = response.data;

        // もしレスポンスがHTMLじゃなかったら（画像やJSONが直接降ってきた場合）
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            // そのままデータを横流しする
            if (contentType) res.setHeader('Content-Type', contentType);
            return res.send(responseData);
        }

        if (typeof responseData === 'string') {
            const $ = cheerio.load(responseData);

            // 💡 基準URLを最終到達URLに設定
            $('head').prepend(`<base href="${finalTargetUrl}">`);

            // 【超重要】GoogleやDuckDuckGoのセキュリティ制限（CSP）を無効化する
            $('meta[http-equiv="Content-Security-Policy"]').remove();
            $('meta[http-equiv="content-security-policy"]').remove();

            // 1. CSSのフェッチ & インライン化
            const cssPromises = [];
            $('link[rel="stylesheet"]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                try {
                    const absoluteCssUrl = new URL(href.trim(), finalTargetUrl).href;
                    const fetchCss = axios.get(absoluteCssUrl, { 
                        timeout: 3000,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    }).then(cssRes => {
                        const cleanedCss = rewriteCssUrls(cssRes.data, absoluteCssUrl);
                        $(el).replaceWith(`<style>${cleanedCss}</style>`);
                    }).catch(() => {
                        $(el).attr('href', absoluteCssUrl);
                    });
                    cssPromises.push(fetchCss);
                } catch (e) {}
            });
            await Promise.all(cssPromises);

            // 2. [href] の書き換え（検索結果のリンクをクリックしたときの対策）
            $('[href]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;

                const trimmedHref = href.trim();
                if (trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:')) return;
                if (el.name === 'link' && $(el).attr('rel') === 'stylesheet') return;

                try {
                    const absoluteUrl = new URL(trimmedHref, finalTargetUrl).href;
                    if (el.name === 'a') {
                        const escapedUrl = absoluteUrl.replace(/'/g, "\\'");
                        // 親のウィンドウへ移動を通知
                        $(el).attr('href', `javascript:window.parent.postMessage({type: 'navigate', url: '${escapedUrl}'}, '*'); void(0);`);
                        $(el).removeAttr('target');
                    } else {
                        $(el).attr('href', absoluteUrl);
                    }
                } catch (e) {}
            });

            // 3. Service Workerの登録スクリプト
            $('head').prepend(`
            <script>
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/sw.js', { scope: './' });
                }
            </script>
            `);

            // 4. その他の [src] を絶対URL化
            $('[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (!src) return;
                try {
                    const absoluteUrl = new URL(src.trim(), finalTargetUrl).href;
                    $(el).attr('src', absoluteUrl);
                } catch (e) {}
            });


            // --- server.js の /proxy-html 内、 const $ = cheerio.load(responseData); の直下に挿入 ---

// アクセス先のURLから、ドメイン（例: crazygames.com）を自動抽出
const targetUrlObj = new URL(finalTargetUrl);
const targetHostname = targetUrlObj.hostname;
const targetOrigin = targetUrlObj.origin;

// 💡 【汎用対策1】あらゆるサイトの iframe検知とドメインチェックを完全にダマす
$('head').prepend(`
<script>
    (function() {
        // 1. iframe脱出（Frame Buster）対策: window.top や parent を自分自身だと思い込ませる
        try {
            if (window.top !== window.self) {
                Object.defineProperty(window, 'top', { get: function() { return window; } });
                Object.defineProperty(window, 'parent', { get: function() { return window; } });
            }
        } catch(e) {}

        // 2. ドメイン偽装: アクセス先のホスト名（${targetHostname}）に強制的に書き換える
        // ※ 多くのゲームはこの値を見て海賊版サイトかどうかを判定しています
        const originalLocation = window.location;
        const fakeLocation = Object.create(originalLocation);
        
        Object.defineProperty(fakeLocation, 'hostname', { get: () => '${targetHostname}' });
        Object.defineProperty(fakeLocation, 'host', { get: () => '${targetHostname}' });
        Object.defineProperty(fakeLocation, 'origin', { get: () => '${targetOrigin}' });
        Object.defineProperty(fakeLocation, 'href', { get: () => '${finalTargetUrl}' });

        try {
            Object.defineProperty(window, 'document', {
                value: window.document,
                writable: false,
                configurable: true
            });
            // document.domain の書き換え（古いサイトのセキュリティ対策）
            Object.defineProperty(window.document, 'domain', { get: () => '${targetHostname}' });
        } catch(e) {}

        try {
            // 一部の強固なサイト向けに window.location 自体を上書き試行
            Object.defineProperty(window, 'location', { get: () => fakeLocation });
        } catch(e) {}
    })();
</script>
`);

// 💡 【汎用対策2】よくあるゲーム用SDK（広告・海賊版検知API）を片っ端からダミー化してエラー落ちを防ぐ
$('head').prepend(`
<script>
    (function() {
        // Poki SDK
        window.PokiSDK = { init: () => Promise.resolve(), startCommercialBreak: (cb) => { if(cb) cb(); }, gameLoadingStart: ()=>{}, gameLoadingProgress: ()=>{}, gameLoadingFinished: ()=>{}, gameplayStart: ()=>{}, gameplayStop: ()=>{} };
        
        // CrazyGames SDK
        window.CrazyGames = { SDK: { game: { gameplayStart: ()=>{}, gameplayStop: ()=>{} }, ad: { requestAd: (t, cb) => { if(cb) cb(); } } } };
        
        // GameDistribution (GD) SDK
        window.gdsdk = { showAd: () => new Promise(resolve => resolve()), preloadAd: () => new Promise(resolve => resolve()) };
        
        // Y8 SDK
        window.ID = { GameAPI: { init: ()=>{}, isReady: ()=>true } };
    })();
</script>
`);

// 💡 【汎用対策3】通信を邪魔する可能性のあるスクリプトの無害化
$('script').each((_, el) => {
    const src = $(el).attr('src') || '';
    
    // Google Analyticsやよくあるトラッキング、広告ブロック検知を削除
    // これらが読み込めない（CORS等で弾かれる）と、ゲームのロード自体を止めてしまうサイトがあるため
    const blockList = ['analytics', 'gtag', 'adsense', 'prebid', 'sentry'];
    if (blockList.some(keyword => src.includes(keyword))) {
        $(el).removeAttr('src');
        $(el).text('/* Blocked Tracking/Ad Script */');
    }
});

            responseData = $.html();
        }

        // セキュリティヘッダーをあなた自身のサーバー側で削除してブラウザに返す
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Frame-Options'); // iframe内での表示を許可させる
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(responseData);

    } catch (error) {
        console.error('Search Proxy Error:', error.message);
        res.status(500).send(`Search Proxy Error: ${error.message}`);
    }
});

// server.js に追加
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'sw.js'));
});


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});
