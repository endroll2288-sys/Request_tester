document.getElementById('sendRequest').addEventListener('click', async () => {
    const url = document.getElementById('urlInput').value;
    const method = document.getElementById('methodSelect').value;
    const body = document.getElementById('bodyInput').value;
    const token = document.getElementById('tokenInput').value;

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: method === 'GET' ? null : body ? JSON.stringify(body) : undefined,
        });

        const responseData = await response.json();
        document.getElementById('responseOutput').textContent = JSON.stringify(responseData, null, 2);
    } catch (error) {
        document.getElementById('responseOutput').textContent = `エラー: ${error.message}`;
    }
});
