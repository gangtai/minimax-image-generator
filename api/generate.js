// Vercel Serverless Function for MiniMax Image Generation
// With Gemini Failover - API Key and Password from Environment Variables

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

// Gemini Image Generation
async function generateWithGemini(prompt, apiKey) {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt: prompt,
            number_of_images: 1
        })
    });
    
    const data = await response.json();
    
    if (data.error) {
        throw new Error(data.error.message || 'Gemini API error');
    }
    
    // Return Gemini's image URL
    return data.predictions?.[0]?.base64Encoding;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    // 從環境變數讀取
    const API_KEY = process.env.MINIMAX_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const PASSWORD = process.env.APP_PASSWORD;
    
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
    
    // 嘗試 MiniMax
    if (API_KEY) {
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
            
            if (data.base_resp?.status_code === 0 && data.data?.image_urls?.[0]) {
                return res.status(200).json({
                    success: true,
                    image_url: data.data.image_urls[0],
                    source: 'minimax'
                });
            }
            
            // MiniMax failed, log but continue to failover
            console.log('MiniMax failed:', data.base_resp?.status_msg);
            
        } catch (error) {
            console.log('MiniMax error:', error.message);
        }
    }
    
    // 嘗試 Gemini (if available)
    if (GEMINI_API_KEY) {
        try {
            // Use Gemini's image generation via Vertex AI or other method
            // Note: This is a placeholder - actual Gemini image API may differ
            const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`, {
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
            });
            
            const geminiData = await geminiResponse.json();
            
            if (geminiData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
                const base64Image = geminiData.candidates[0].content.parts[0].inlineData.data;
                return res.status(200).json({
                    success: true,
                    image_data: base64Image,
                    source: 'gemini'
                });
            }
            
        } catch (error) {
            console.log('Gemini error:', error.message);
        }
    }
    
    // All failed
    return res.status(503).json({ error: '所有圖片生成服務暫時無法使用，請稍後再試' });
}
