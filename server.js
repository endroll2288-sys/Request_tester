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
                        // 読み込めたら、<link>タグを<style>タグに置き換える
                        $(el).replaceWith(`<style>/* Inline CSS from ${href} */\n${cssRes.data}</style>`);
                    }).catch(err => {
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

            // 既存のsrc属性（imgタグなど）の絶対URL化処理
    // 【server.js の [src] 処理部分を以下に修正】

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


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});


