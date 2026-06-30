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


            // 既存のhref属性（aタグなど）の絶対URL化処理
            $('[href]').each((_, el) => {
                // すでに<style>に置き換わったものはスキップされる
                if (el.name === 'link' && $(el).attr('rel') === 'stylesheet') return;
                
                const href = $(el).attr('href');
                if (!href) return;
                const trimmedHref = href.trim();
                if (trimmedHref.startsWith('#') || trimmedHref.startsWith('javascript:')) return;

                if (!trimmedHref.startsWith('http://') && !trimmedHref.startsWith('https://') && !trimmedHref.startsWith('//') && !trimmedHref.startsWith('data:')) {
                    try {
                        $(el).attr('href', new URL(trimmedHref, targetUrl).href);
                    } catch (e) {}
                }
            });

            // 既存のsrc属性（imgタグなど）の絶対URL化処理
            $('[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (!src) return;
                const trimmedSrc = src.trim();
                if (trimmedSrc.startsWith('#') || trimmedSrc.startsWith('javascript:')) return;

                if (!trimmedSrc.startsWith('http://') && !trimmedSrc.startsWith('https://') && !trimmedSrc.startsWith('//') && !trimmedSrc.startsWith('data:')) {
                    try {
                        $(el).attr('src', new URL(trimmedSrc, targetUrl).href);
                    } catch (e) {}
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


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});


