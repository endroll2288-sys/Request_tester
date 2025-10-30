
document.getElementById('sendRequest').addEventListener('click', async () => {
    const url = document.getElementById('urlInput').value;
    const method = document.getElementById('methodSelect').value;
    const body = document.getElementById('bodyInput').value;
    
    // ヘッダーの取得
    const headers = {};
    const headerKeys = document.getElementsByClassName('header-key');
    const headerValues = document.getElementsByClassName('header-value');

    for (let i = 0; i < headerKeys.length; i++) {
        const key = headerKeys[i].value.trim();
        const value = headerValues[i].value.trim();
        if (key && value) {
            headers[key] = value;
        }
    }

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers, // ヘッダーをここに追加
            },
            body: method === 'GET' ? null : body ? JSON.stringify(body) : undefined,
        });

        const responseData = await response.json();
        document.getElementById('responseOutput').textContent = JSON.stringify(responseData, null, 2);
    } catch (error) {
        document.getElementById('responseOutput').textContent = `エラー: ${error.message}`;
    }
});

// ヘッダーを追加する機能
document.getElementById('addHeader').addEventListener('click', () => {
    const headerFields = document.getElementById('headerFields');
    const newHeaderField = document.createElement('div');
    newHeaderField.innerHTML = `
        <input type="text" class="header-key" placeholder="ヘッダー名" />
        <input type="text" class="header-value" placeholder="ヘッダー値" />
    `;
    headerFields.appendChild(newHeaderField);
});
