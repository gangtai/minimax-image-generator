// Vercel Serverless Function for MiniMax Image Generation
// API Key and Password from Environment Variables (NOT in source code!)

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

const rateLimitStore = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitStore.get(ip);
    
    if (!record) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }
    
    if (now > record.resetTime) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }
    
    if (record.count >= RATE_LIMIT) {
        return false;
    }
    
    record.count++;
    return true;
}

const BLOCKED_KEYWORDS = [
    'violence', 'nude', 'nsfw', 'porn', 'sex',
    'weapon', 'blood', 'gore', 'kill', 'death',
    'hate', 'racist', 'fraud', 'scam'
];

function checkContent(prompt) {
    const lower = prompt.toLowerCase();
    for (const keyword of BLOCKED_KEYWORDS) {
        if (lower.includes(keyword)) {
            return false;
        }
    }
    return true;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    // 從環境變數讀取（不在程式碼中！）
    const API_KEY = process.env.MINIMAX_API_KEY;
    const PASSWORD = process.env.APP_PASSWORD;
    
    if (!API_KEY) return res.status(500).json({ error: '伺服器設定錯誤，請聯絡管理員' });
    if (!PASSWORD) return res.status(500).json({ error: '密碼未設定，請聯絡管理員' });
    
    const { password, prompt } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    
    if (password !== PASSWORD) {
        return res.status(401).json({ error: '密碼錯誤，請聯絡志工取得正確密碼' });
    }
    
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: '請求次數過多，請稍後再試' });
    }
    
    if (!prompt) return res.status(400).json({ error: '請輸入 prompt' });
    if (prompt.length > 200) return res.status(400).json({ error: 'Prompt 太長，請少於 200 字' });
    if (!checkContent(prompt)) return res.status(400).json({ error: 'Prompt 包含不當內容，請更換描述' });
    
    try {
        const response = await fetch('https://api.minimax.io/v1/image_generation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'image-01',
                prompt: prompt,
                image_num: 1,
                width: 1024,
                height: 1024
            })
        });
        
        const data = await response.json();
        
        if (data.base_resp?.status_code !== 0) {
            throw new Error(data.base_resp?.status_msg || 'API 錯誤');
        }
        
        res.status(200).json({
            success: true,
            image_url: data.data?.image_urls?.[0]
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
}
