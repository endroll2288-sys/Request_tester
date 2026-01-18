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
  
 console.log(req.body);
  
  console.log(`[Proxy Request] ${method} -> ${targetUrl}`);

    try {
        // Axiosを使って実際のターゲットへリクエスト送信
        const response = await axios({
            url: targetUrl,
            method: method || 'GET',
            headers: headers || {},
            data: body || undefined,
            validateStatus: () => true // どのようなステータスコードでもエラーにしない
        });

        // ターゲットからのレスポンスをクライアントへそのまま返す
        res.json({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
        });

    } catch (error) {
        
        console.error('Proxy Error:', error.message);
        res.status(500).json({
            error: error.message,
            details: error.response ? error.response.data : 'No response from target'
        });
    }
});


app.listen(PORT, () => {
    console.log(`Proxy Server running at http://localhost:${PORT}`);
});


