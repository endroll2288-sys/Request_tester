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

// 💡 POST通信を転送できるよう、大容量のJSON/テキスト/バイナリパースを許可
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'sw.js'));
});

// 画像プロキシ
app.get('/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(imageUrl).origin
            },
            validateStatus: () => true
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.send(response.data);
    } catch (error) {
        console.error('Image Proxy Error:', error.message);
        res.status(500).send('Failed to fetch image');
    }
});

// メディアプロキシ
app.get('/proxy-media', async (req, res) => {
    const mediaUrl = req.query.url;
    if (!mediaUrl) return res.status(400).send('URL is required');

    try {
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': new URL(mediaUrl).origin
        };
        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream',
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
        if (!res.headersSent) res.status(500).send('Failed to stream media');
    }
});

// 💡 【大幅強化】JavaScript、API（Fetch/XHR）、POST通信の共通プロキシ
// app.all に変更し、GETだけでなくPOSTやPUTもすべて本家サーバーに丸投げできるようにしました
app.all('/proxy-fetch', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    try {
        const urlObj = new URL(targetUrl);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': urlObj.origin,
            'Referer': urlObj.origin + '/'
        };

        // 相手サーバーが要求するContent-Typeがあれば引き継ぐ
        if (req.headers['content-type']) {
            headers['content-type'] = req.headers['content-type'];
        }

        const axiosConfig = {
            url: targetUrl,
            method: req.method, // 元のリクエスト(GETやPOST)をそのまま維持
            headers: headers,
            responseType: 'arraybuffer', // 💡 JSON、JS、圧縮バイナリ等すべてを壊さず受け取るために必須
            validateStatus: () => true
        };

        // POST/PUTの場合は、クライアントから送られてきたBodyをそのまま乗せる
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            axiosConfig.data = req.body;
        }

        const response = await axios(axiosConfig);

        // レスポンスヘッダーの引き継ぎ
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-encoding']) res.setHeader('Content-Encoding', response.headers['content-encoding']);

        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('Fetch Proxy Error:', error.message);
        res.status(500).send(`Fetch Proxy Error: ${error.message}`);
    }
});

// HTML配信プロキシ
app.get('/proxy-html', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

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
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400
        });

        const finalTargetUrl = response.config.url || targetUrl;
        let responseData = response.data;

        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            if (contentType) res.setHeader('Content-Type', contentType);
            return res.send(responseData);
        }

        if (typeof responseData === 'string') {
            const $ = cheerio.load(responseData);
            const targetUrlObj = new URL(finalTargetUrl);
            const targetHostname = targetUrlObj.hostname;
            const targetOrigin = targetUrlObj.origin;

            // 基準URLを設定
            $('head').prepend(`<base href="${finalTargetUrl}">`);

            // CSPメタタグの削除
            $('meta[http-equiv="Content-Security-Policy"]').remove();
            $('meta[http-equiv="content-security-policy"]').remove();

            // 💡 iframe検知・ドメインチェック偽装のインジェクション
            $('head').prepend(`
            <script>
                (function() {
                    try {
                        if (window.top !== window.self) {
                            Object.defineProperty(window, 'top', { get: function() { return window; } });
                            Object.defineProperty(window, 'parent', { get: function() { return window; } });
                        }
                    } catch(e) {}

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
                        Object.defineProperty(window.document, 'domain', { get: () => '${targetHostname}' });
                    } catch(e) {}

                    try {
                        Object.defineProperty(window, 'location', { get: () => fakeLocation });
                    } catch(e) {}
                })();
            </script>
            `);

            // ゲーム用SDKのダミー化
            $('head').prepend(`
            <script>
                (function() {
                    window.PokiSDK = { init: () => Promise.resolve(), startCommercialBreak: (cb) => { if(cb) cb(); }, gameLoadingStart: ()=>{}, gameLoadingProgress: ()=>{}, gameLoadingFinished: ()=>{}, gameplayStart: ()=>{}, gameplayStop: ()=>{} };
                    window.CrazyGames = { SDK: { game: { gameplayStart: ()=>{}, gameplayStop: ()=>{} }, ad: { requestAd: (t, cb) => { if(cb) cb(); } } } };
                    window.gdsdk = { showAd: () => new Promise(resolve => resolve()), preloadAd: () => new Promise(resolve => resolve()) };
                    window.ID = { GameAPI: { init: ()=>{}, isReady: ()=>true } };
                })();
            </script>
            `);

            // トラッキングスクリプト無害化
            $('script').each((_, el) => {
                const src = $(el).attr('src') || '';
                const blockList = ['analytics', 'gtag', 'adsense', 'prebid', 'sentry', 'facebook', 'twitter'];
                if (blockList.some(keyword => src.includes(keyword))) {
                    $(el).removeAttr('src');
                    $(el).text('/* Blocked Tracking/Ad Script */');
                }
            });

            // 1. CSSのインライン化
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

            // 2. [href] のプロキシ・絶対URL化
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
                        $(el).attr('href', `javascript:window.parent.postMessage({type: 'navigate', url: '${escapedUrl}'}, '*'); void(0);`);
                        $(el).removeAttr('target');
                    } else {
                        $(el).attr('href', absoluteUrl);
                    }
                } catch (e) {}
            });

            // 3. Service Workerの登録スクリプト

            // 3. Service Workerの登録スクリプト（URL・スコープ完全固定版）
$('head').prepend(`
<script>
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
           
            const actualProxyOrigin = window.parent.location.origin; 
            
            navigator.serviceWorker.register(actualProxyOrigin + '/sw.js', { scope: actualProxyOrigin + '/' })
            .then(reg => console.log('SW Registered successfully with scope:', reg.scope))
            .catch(err => console.error('SW Failed:', err));
        });
    }
</script>
`);


            // 4. メディアタグのストリーミング書き換え
            $('video, audio, source, track, embed, object').each((_, el) => {
                const attributes = ['src', 'poster', 'data'];
                attributes.forEach(attr => {
                    const value = $(el).attr(attr);
                    if (!value) return;
                    const trimmedValue = value.trim();
                    if (trimmedValue.startsWith('data:')) return;

                    try {
                        const absoluteUrl = new URL(trimmedValue, finalTargetUrl).href;
                        if (attr === 'poster') {
                            $(el).attr(attr, `/proxy-image?url=${encodeURIComponent(absoluteUrl)}`);
                        } else {
                            $(el).attr(attr, `/proxy-media?url=${encodeURIComponent(absoluteUrl)}`);
                        }
                    } catch (e) {}
                });
            });

            // 5. フォーム送信の横取り
            $('form').each((_, el) => {
                const action = $(el).attr('action') || '';
                const method = ($(el).attr('method') || 'GET').toUpperCase();
                try {
                    const absoluteActionUrl = new URL(action.trim(), finalTargetUrl).href;
                    $(el).attr('action', absoluteActionUrl);
                    $(el).attr('data-proxy-method', method);
                    $(el).attr('data-proxy-action', absoluteActionUrl);
                    $(el).attr('onsubmit', 'return false;');
                } catch (e) {}
            });

            // 6. [src] 属性の絶対パス化
            $('[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (!src) return;
                const trimmedSrc = src.trim();
                if (trimmedSrc.startsWith('#') || trimmedSrc.startsWith('javascript:')) return;
                if (['video', 'audio', 'source', 'track', 'embed', 'object'].includes(el.name)) return;

                try {
                    const absoluteUrl = new URL(trimmedSrc, finalTargetUrl).href;
                    $(el).attr('src', absoluteUrl);
                    
                    if (el.name === 'img') {
                        $(el).attr('data-original-src', absoluteUrl);
                        $(el).attr('onerror', 'window.parent.handleImageError(this)');
                    }
                } catch (e) {}
            });

            // 💡 【プロキシの最終奥義】
// JavaScript自体が後から動的に作成する「相対パス」の通信を、ブラウザの根本（window.fetch や XMLHttpRequest）から横取りして絶対パスに強制変換するスクリプト

$('head').prepend(`
<script>
    (function() {
        const base = '${finalTargetUrl}';

       
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
            if (typeof input === 'string' && !input.startsWith('http') && !input.startsWith('//')) {
                input = new URL(input, base).href;
            }
            return originalFetch(input, init);
        };

       
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
                url = new URL(url, base).href;
            }
            return originalOpen.apply(this, [method, url, ...args]);
        };

        
        const originalAppendChild = Element.prototype.appendChild;
        Element.prototype.appendChild = function(element) {
            if (element && (element.tagName === 'SCRIPT' || element.tagName === 'IMG')) {
                const src = element.getAttribute('src');
                if (src && !src.startsWith('http') && !src.startsWith('//')) {
                    element.setAttribute('src', new URL(src, base).href);
                }
            }
            return originalAppendChild.call(this, element);
        };
    })();
</script>
`);

            $('head').prepend(`
<script>
    (function() {
        const targetHostname = '${targetHostname}';
        const targetOrigin = '${targetOrigin}';
        const finalTargetUrl = '${finalTargetUrl}';

      
        try {
            if (window.top !== window.self) {
                Object.defineProperty(window, 'top', { get: function() { return window; }, configurable: true });
                Object.defineProperty(window, 'parent', { get: function() { return window; }, configurable: true });
            }
        } catch(e) {}

       
        const originalLocation = window.location;
        const fakeLocation = new Proxy(originalLocation, {
            get: function(target, prop) {
                if (prop === 'hostname' || prop === 'host') return targetHostname;
                if (prop === 'origin') return targetOrigin;
                if (prop === 'href') return finalTargetUrl;
                
                
                const value = target[prop];
                if (typeof value === 'function') {
                    return value.bind(target);
                }
                return value;
            },
            set: function(target, prop, value) {
                
                if (prop === 'href' || prop === 'hash') {
                    window.parent.postMessage({type: 'navigate', url: new URL(value, finalTargetUrl).href}, '*');
                    return true;
                }
                target[prop] = value;
                return true;
            }
        });

        try {
            Object.defineProperty(window, 'location', { get: () => fakeLocation, configurable: true });
        } catch(e) {
           
            window.location.toString = () => finalTargetUrl;
        }

        try {
          
            Object.defineProperty(window.document, 'domain', { get: () => targetHostname, configurable: true });
        } catch(e) {}

        
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
            if (typeof input === 'string' && !input.startsWith('http') && !input.startsWith('//') && !input.startsWith('data:')) {
                input = new URL(input, finalTargetUrl).href;
            }
            return originalFetch(input, init);
        };

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//') && !url.startsWith('data:')) {
                url = new URL(url, finalTargetUrl).href;
            }
            return originalOpen.apply(this, [method, url, ...args]);
        };
    })();
</script>
`);

            responseData = $.html();
        }

        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(responseData);
    } catch (error) {
        console.error('Search Proxy Error:', error.message);
        res.status(500).send(`Search Proxy Error: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});
