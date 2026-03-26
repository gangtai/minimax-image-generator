// Vercel Serverless Function for Image Generation
// Supports: MiniMax, Gemini, and Cloudflare Workers AI (Stable Diffusion XL Lightning)

// Rate limiting
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

// Content filtering
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

// Cloudflare Workers AI - Stable Diffusion XL Lightning
async function generateWithCloudflare(prompt, apiToken, accountId) {
    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers_ai/run`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: '@cf/stabilityai/stable-diffusion-xl-lightning-1x',
                prompt: prompt
            })
        }
    );
    
    const data = await response.json();
    
    if (!response.ok || data.errors) {
        throw new Error(data.errors?.[0]?.message || 'Cloudflare API error');
    }
    
    // Cloudflare returns base64 encoded image
    return data.result?.image;
}

// MiniMax Image Generation
async function generateWithMiniMax(prompt, apiKey) {
    const response = await fetch('https://api.minimax.io/v1/image_generation', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
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
    
    if (data.base_resp?.status_code === 0 && data.data?.image_urls?.[0]) {
        return { type: 'url', url: data.data.image_urls[0] };
    }
    
    throw new Error(data.base_resp?.status_msg || 'MiniMax failed');
}

// Gemini Image Generation
async function generateWithGemini(prompt, apiKey) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: "IMAGE"
                }
            })
        }
    );
    
    const data = await response.json();
    
    if (data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        return {
            type: 'base64',
            data: data.candidates[0].content.parts[0].inlineData.data,
            mimeType: data.candidates[0].content.parts[0].inlineData.mimeType || 'image/png'
        };
    }
    
    throw new Error('Gemini generation failed');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    // 讀取環境變數
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const PASSWORD = process.env.APP_PASSWORD;
    
    if (!PASSWORD) return res.status(500).json({ error: '密碼未設定，請聯絡管理員' });
    
    const { password, prompt } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    
    // 驗證密碼
    if (password !== PASSWORD) {
        return res.status(401).json({ error: '密碼錯誤，請聯絡志工取得正確密碼' });
    }
    
    // 速率限制
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: '請求次數過多，請稍後再試' });
    }
    
    // 驗證 prompt
    if (!prompt) return res.status(400).json({ error: '請輸入 prompt' });
    if (prompt.length > 200) return res.status(400).json({ error: 'Prompt 太長，請少於 200 字' });
    if (!checkContent(prompt)) return res.status(400).json({ error: 'Prompt 包含不當內容，請更換描述' });
    
    // 嘗試順序：Cloudflare (SDXL) -> MiniMax -> Gemini
    let lastError = null;
    
    // 1. Cloudflare Workers AI (Stable Diffusion XL Lightning)
    if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID) {
        try {
            const result = await generateWithCloudflare(prompt, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID);
            if (result) {
                return res.status(200).json({
                    success: true,
                    image_data: result,
                    source: 'cloudflare-sdxl-lightning'
                });
            }
        } catch (error) {
            console.log('Cloudflare error:', error.message);
            lastError = error.message;
        }
    }
    
    // 2. MiniMax
    if (MINIMAX_API_KEY) {
        try {
            const result = await generateWithMiniMax(prompt, MINIMAX_API_KEY);
            return res.status(200).json({
                success: true,
                image_url: result.url,
                source: 'minimax'
            });
        } catch (error) {
            console.log('MiniMax error:', error.message);
            lastError = error.message;
        }
    }
    
    // 3. Gemini (failover)
    if (GEMINI_API_KEY) {
        try {
            const result = await generateWithGemini(prompt, GEMINI_API_KEY);
            return res.status(200).json({
                success: true,
                image_data: result.data,
                image_url: result.type === 'url' ? result.url : null,
                source: 'gemini'
            });
        } catch (error) {
            console.log('Gemini error:', error.message);
            lastError = error.message;
        }
    }
    
    // 全部失敗
    console.log('Last error:', lastError);
    return res.status(503).json({
        error: '所有圖片生成服務暫時無法使用，請稍後再試',
        details: lastError
    });
}
