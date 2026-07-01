import express from 'express';
import axios from 'axios';
import cors from'cors';
import path from "path";
import * as cheerio from 'cheerio'; // 1. cheerioをインポート
//const path = require('path')
const app = express();
const PORT = 3000;
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    
    res.sendFile(path.join(__dirname, 'index.html'));
});

// プロキシ用エンドポイント
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
            
            // --- 👇 [新規追加] CSSの追加fetch & インライン化処理 ---
            const cssPromises = [];
            
            $('link[rel="stylesheet"]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href) return;

                try {
                    // CSSの絶対URLを計算
                    const absoluteCssUrl = new URL(href.trim(), targetUrl).href;
                    
                    // 非同期でCSSを取得するPromiseを配列にためる
                    const fetchCss = axios.get(absoluteCssUrl, { 
                        timeout: 3000, // 3秒でタイムアウト
                        headers: headers || {} 
                    }).then(cssRes => {
    // 👇 [修正] 読み込んだCSSテキスト内のurl()を絶対パスに書き換える
    const cleanedCss = rewriteCssUrls(cssRes.data, absoluteCssUrl);
    
    // 置き換える
    $(el).replaceWith(`<style>/* Inline CSS from ${href} */\n${cleanedCss}</style>`);
})
                        
                        .catch(err => {
                        console.error(`CSS fetch失敗: ${absoluteCssUrl}`, err.message);
                        // 失敗した場合は、ブラウザ側に解決させるため絶対パスのhrefに書き換えておく
                        $(el).attr('href', absoluteCssUrl);
                    });
                    
                    cssPromises.push(fetchCss);
                } catch (e) { /* URLパースエラー時はスルー */ }
            });

            // すべてのCSSのfetchと置き換えが完了するのを待つ
            await Promise.all(cssPromises);
            // --- 👆 ここまで ---


  // 【server.js の [href] 処理部分を以下に修正】

$('[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const trimmedHref = href.trim();
    if (trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:')) return;
    if (el.name === 'link' && $(el).attr('rel') === 'stylesheet') return; // CSSはスルー

    try {
        // 1. 絶対URLを作る
        const absoluteUrl = new URL(trimmedHref, targetUrl).href;
        
        if (el.name === 'a') {
            // 2. <a> タグの場合：クリック時に親画面（window.parent）を操作する特殊なスクリプトを仕込む
            // エスケープ処理をして安全にURLを文字列として渡す
            const escapedUrl = absoluteUrl.replace(/'/g, "\\'");
            
            // hrefの中に、親画面のinputを書き換えて関数を実行するJSを直接埋め込む
            $(el).attr('href', `javascript:window.parent.document.getElementById('url').value='${escapedUrl}'; window.parent.document.getElementById('method').value='GET'; window.parent.sendViaProxy(); void(0);`);
            // 念のためターゲット属性は削除（または _self に）しておく
            $(el).removeAttr('target'); 
        } else {
            $(el).attr('href', absoluteUrl);
        }
    } catch (e) {}
});

// --- 👇 [新規追加] 動画・音声などのマルチメディアリソースの絶対URL化 ---
$('video, audio, source, track, embed, object').each((_, el) => {
    // それぞれのタグが持ちうるURL属性をチェック
    const attributes = ['src', 'poster', 'data'];
    
    attributes.forEach(attr => {
        const value = $(el).attr(attr);
        if (!value) return;

        const trimmedValue = value.trim();
        // すでに絶対パス等の場合はスルー
        if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://') || trimmedValue.startsWith('//') || trimmedValue.startsWith('data:')) {
            return;
        }

        try {
            const absoluteUrl = new URL(trimmedValue, targetUrl).href;
            $(el).attr(attr, absoluteUrl);
        } catch (e) {}
    });
});
// --- 👆 ここまで ---
            
// --- 👇 [新規追加] <form> タグのプロキシ化処理 ---
$('form').each((_, el) => {
    const action = $(el).attr('action') || '';
    const method = ($(el).attr('method') || 'GET').toUpperCase();

    try {
        // 1. action 属性を絶対URLに変換する
        const absoluteActionUrl = new URL(action.trim(), targetUrl).href;
        $(el).attr('action', absoluteActionUrl);

        // 2. フロントエンドのJavaScriptでフックしやすいように、データ属性を仕込んでおく
        $(el).attr('data-proxy-method', method);
        $(el).attr('data-proxy-action', absoluteActionUrl);
        
        // 3. 通常の送信（ページ遷移）が起きないように、インラインでonsubmitを無効化（念のため）
        // 実際の処理は親画面から注入するイベントリスナーで行います
        $(el).attr('onsubmit', 'return false;');
    } catch (e) { /* URLパースエラー時はスルー */ }
});
// --- 👆 ここまで ---


            
// --- 👇 [新規追加] JSの追加fetch & インライン化処理 ---
const jsPromises = [];

$('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;

    // 外部のプラグイン（Google Analytics、SNSシェアボタン、広告など）は除外
    // これらをインライン化するとエラーや動作遅延の原因になります
    if (src.includes('google') || src.includes('facebook') || src.includes('twitter') || src.includes('analytics')) {
        return;
    }

    try {
        // JSの絶対URLを計算
        const absoluteJsUrl = new URL(src.trim(), targetUrl).href;
        
        // 非同期でJSを取得
        const fetchJs = axios.get(absoluteJsUrl, { 
            timeout: 3000, // 3秒でタイムアウト
            headers: headers || {} 
        }).then(jsRes => {
            // 読み込めたら、src属性を消して、タグの中にJSのコードを直接埋め込む
            $(el).removeAttr('src');
            $(el).text(`/* Inline JS from ${src} */\n${jsRes.data}`);
        }).catch(err => {
            console.error(`JS fetch失敗: ${absoluteJsUrl}`, err.message);
            // 失敗した場合は、ブラウザ側に解決させるため絶対パスのsrcにしておく
            $(el).attr('src', absoluteJsUrl);
        });
        
        jsPromises.push(fetchJs);
    } catch (e) { /* URLパースエラー時はスルー */ }
});

// CSSのPromise配列と一緒に待つか、ここで個別に待つ
await Promise.all(jsPromises);
// --- 👆 ここまで ---
            // 既存のsrc属性（imgタグなど）の絶対URL化処理
    // 【server.js の [src] 処理部分を以下に修正】

$('style').each((_, el) => {
    const rawCss = $(el).text();
    const rewrittenCss = rewriteCssUrls(rawCss, targetUrl);
    $(el).text(rewrittenCss);
});

// --- [新規追加] imgやsourceタグの srcset 属性の絶対URL化 ---
$('[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (!srcset) return;

    // コンマで区切られた各リソースのパスを分解して処理
    const rewrittenSrcset = srcset.split(',').map(part => {
        const match = part.trim().match(/^(\S+)(.*)$/);
        if (!match) return part;

        const urlPath = match[1];
        const descriptor = match[2]; // 「320w」や「2x」などの識別子

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
// ---  ここまで ---
            
            
$('[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;

    const trimmedSrc = src.trim();
    if (trimmedSrc.startsWith('#') || trimmedSrc.startsWith('javascript:')) return;

    if (!trimmedSrc.startsWith('http://') && !trimmedSrc.startsWith('https://') && !trimmedSrc.startsWith('//') && !trimmedSrc.startsWith('data:')) {
        try {
            const absoluteUrl = new URL(trimmedSrc, targetUrl).href;
            $(el).attr('src', absoluteUrl);
            
            // 💡 [新規追加] imgタグの場合、エラーハンドリング用の属性を仕込む
            if (el.name === 'img') {
                $(el).attr('data-original-src', absoluteUrl);
                $(el).attr('onerror', 'window.parent.handleImageError(this)');
            }
        } catch (e) {}
    } else {
        // すでに絶対パス（http〜）で書かれているimgタグにも同様に仕込む
        if (el.name === 'img') {
            $(el).attr('data-original-src', trimmedSrc);
            $(el).attr('onerror', 'window.parent.handleImageError(this)');
        }
    }
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

// 【server.js に新規追加：画像プロキシ用】
app.get('/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer', // 画像バイナリをそのまま受け取る
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
        });

        // ターゲットから返ってきた Content-Type をそのまま引き継ぐ（image/png など）
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.send(response.data);
    } catch (error) {
        console.error('Image Proxy Error:', error.message);
        res.status(500).send('Failed to fetch image');
    }
});


// --- 👇 [新規追加] 動画・音声用のストリーミングプロキシ ---
app.get('/proxy-media', async (req, res) => {
    const mediaUrl = req.query.url;
    if (!mediaUrl) return res.status(400).send('URL is required');

    try {
        // ブラウザからのRangeヘッダー（「動画のココからココまでを頂戴」という要求）を引き継ぐ
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };
        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            url: mediaUrl,
            method: 'GET',
            responseType: 'stream', // 💡 ここが重要！丸ごとではなく「ストリーム（流体）」として受け取る
            headers: requestHeaders,
            validateStatus: () => true
        });

        // ターゲットから返ってきた重要なヘッダーをブラウザにそのまま横流しする
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
        
        // ステータスコード（通常の200や、部分配信の206 Partial Contentなど）をそのまま引き継ぐ
        res.status(response.status);

        // データをリアルタイムにブラウザへ流し込む（パイプ）
        response.data.pipe(res);

    } catch (error) {
        console.error('Media Proxy Error:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Failed to stream media');
        }
    }
});
// --- 👆 ここまで ---


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});

// --- CSS内のurl()を絶対パスに書き換える関数 ---
function rewriteCssUrls(cssText, baseUrl) {
    // url(...) または url("...") または url('...') のパターンにマッチする正規表現
    return cssText.replace(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, urlPath) => {
        const trimmedUrl = urlPath.trim();
        
        // すでに絶対パス、データURI、またはハッシュの場合はスキップ
        if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://') || trimmedUrl.startsWith('//') || trimmedUrl.startsWith('data:')) {
            return match;
        }
        
        try {
            // 計算して絶対URLを作る
            const absoluteUrl = new URL(trimmedUrl, baseUrl).href;
            return `url(${quote}${absoluteUrl}${quote})`;
        } catch (e) {
            return match;
        }
    });
}
// ---  ここまで ---
