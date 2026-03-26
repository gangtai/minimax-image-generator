// Vercel Serverless Function for Image Generation
// Supports: Cloudflare Workers AI (SDXL), MiniMax, and Gemini

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
    if (record.count >= RATE_LIMIT) return false;
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
        if (lower.includes(keyword)) return false;
    }
    return true;
}

// Cloudflare Workers AI - Stable Diffusion XL Lightning
async function generateWithCloudflare(prompt, apiToken, accountId) {
    console.log('DEBUG: Cloudflare called, accountId:', accountId);
    
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/bytedance/stable-diffusion-xl-lightning`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: prompt })
    });
    
    console.log('DEBUG: Cloudflare status:', response.status);
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('image')) {
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        console.log('DEBUG: Cloudflare image OK, size:', buffer.byteLength);
        return base64;
    }
    
    const data = await response.json();
    console.log('DEBUG: Cloudflare response:', JSON.stringify(data).substring(0, 200));
    throw new Error(data.errors?.[0]?.message || 'Cloudflare failed');
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: "IMAGE" }
            })
        }
    );
    
    const data = await response.json();
    if (data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        return { type: 'base64', data: data.candidates[0].content.parts[0].inlineData.data };
    }
    throw new Error('Gemini failed');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const PASSWORD = process.env.APP_PASSWORD;
    
    console.log('DEBUG env:', {
        cf: !!CLOUDFLARE_API_TOKEN,
        cfId: !!CLOUDFLARE_ACCOUNT_ID,
        mini: !!MINIMAX_API_KEY,
        gem: !!GEMINI_API_KEY,
        pwd: !!PASSWORD
    });
    
    if (!PASSWORD) return res.status(500).json({ error: 'Password not set' });
    
    const { password, prompt } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    
    if (password !== PASSWORD) return res.status(401).json({ error: 'Password incorrect' });
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });
    if (!prompt) return res.status(400).json({ error: 'No prompt' });
    if (prompt.length > 200) return res.status(400).json({ error: 'Prompt too long' });
    if (!checkContent(prompt)) return res.status(400).json({ error: 'Prompt contains blocked content' });
    
    let lastError = null;
    
    // 1. Cloudflare
    if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID) {
        try {
            const result = await generateWithCloudflare(prompt, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID);
            return res.status(200).json({ success: true, image_data: result, source: 'cloudflare' });
        } catch (e) {
            console.log('DEBUG: Cloudflare failed:', e.message);
            lastError = 'Cloudflare: ' + e.message;
        }
    }
    
    // 2. MiniMax
    if (MINIMAX_API_KEY) {
        try {
            const result = await generateWithMiniMax(prompt, MINIMAX_API_KEY);
            return res.status(200).json({ success: true, image_url: result.url, source: 'minimax' });
        } catch (e) {
            console.log('DEBUG: MiniMax failed:', e.message);
            lastError = 'MiniMax: ' + e.message;
        }
    }
    
    // 3. Gemini
    if (GEMINI_API_KEY) {
        try {
            const result = await generateWithGemini(prompt, GEMINI_API_KEY);
            return res.status(200).json({ success: true, image_data: result.data, source: 'gemini' });
        } catch (e) {
            console.log('DEBUG: Gemini failed:', e.message);
            lastError = 'Gemini: ' + e.message;
        }
    }
    
    return res.status(503).json({
        error: 'All services failed',
        lastError: lastError,
        env: {
            cf: !!CLOUDFLARE_API_TOKEN,
            cfId: !!CLOUDFLARE_ACCOUNT_ID,
            mini: !!MINIMAX_API_KEY,
            gem: !!GEMINI_API_KEY
        }
    });
}
