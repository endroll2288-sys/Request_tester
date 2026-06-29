import express from 'express';
import axios from 'axios';
import cors from'cors';
import path from "path";
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
            // HTMLをテキスト（文字列）として確実に受け取る設定
            responseType: 'text', 
            validateStatus: () => true
        });

        let responseData = response.data;

        // 2. レスポンスがHTML、かつリクエストが成功している場合にパスを書き換える
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && typeof responseData === 'string') {
            
            const $ = cheerio.load(responseData);
            const targetBase = new URL(targetUrl); // ターゲットのURLオブジェクトを作成

            // 3. 画像やCSS、JSなどのタグを抽出してURLを絶対パスに置換
            // href属性を持つタグ (link, a など)
            $('[href]').each((_, el) => {
                const href = $(el).attr('href');
                if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//') && !href.startsWith('data:')) {
                    try {
                        // 相対パスを絶対URLに変換
                        const absoluteUrl = new URL(href, targetBase.origin + targetBase.pathname).href;
                        $(el).attr('href', absoluteUrl);
                    } catch (e) { /* パース失敗時はスルー */ }
                }
            });

            // src属性を持つタグ (img, script, iframe など)
            $('[src]').each((_, el) => {
                const src = $(el).attr('src');
                if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//') && !src.startsWith('data:')) {
                    try {
                        const absoluteUrl = new URL(src, targetBase.origin + targetBase.pathname).href;
                        $(el).attr('src', absoluteUrl);
                    } catch (e) { /* パース失敗時はスルー */ }
                }
            });

            // 書き換えたHTMLをレスポンスに設定
            responseData = $.html();
        }

        res.json({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: responseData // 書き換え済みのHTML、または通常のJSONデータ
        });

    } // エラー時のレスポンス（status というキーが存在しない！）
catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).json({
        error: error.message,
        details: error.response ? error.response.data : 'No response from target'
    });
}
    
    /*catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).json({ error: error.message });
    }*/
});


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});


