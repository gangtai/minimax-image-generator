// Vercel Serverless Function for Image Generation
// Supports: Cloudflare Workers AI (SDXL), MiniMax, and Gemini

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
    console.log('DEBUG: checkRateLimit called for IP:', ip);
    const now = Date.now();
    const record = rateLimitStore.get(ip);
    
    if (!record) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        console.log('DEBUG: New rate limit record created');
        return true;
    }
    
    if (now > record.resetTime) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        console.log('DEBUG: Rate limit reset');
        return true;
    }
    
    if (record.count >= RATE_LIMIT) {
        console.log('DEBUG: Rate limit exceeded');
        return false;
    }
    
    record.count++;
    console.log('DEBUG: Rate limit count:', record.count);
    return true;
}

const BLOCKED_KEYWORDS = [
    'violence', 'nude', 'nsfw', 'porn', 'sex',
    'weapon', 'blood', 'gore', 'kill', 'death',
    'hate', 'racist', 'fraud', 'scam'
];

function checkContent(prompt) {
    console.log('DEBUG: checkContent called with prompt:', prompt.substring(0, 50));
    const lower = prompt.toLowerCase();
    for (const keyword of BLOCKED_KEYWORDS) {
        if (lower.includes(keyword)) {
            console.log('DEBUG: Blocked keyword found:', keyword);
            return false;
        }
    }
    return true;
}

// Cloudflare Workers AI - Stable Diffusion XL Lightning
async function generateWithCloudflare(prompt, apiToken, accountId) {
    console.log('DEBUG: generateWithCloudflare called');
    console.log('DEBUG: Account ID:', accountId);
    console.log('DEBUG: Token exists:', !!apiToken, apiToken ? apiToken.substring(0, 10) + '...' : 'none');
    
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers_ai/run`;
    console.log('DEBUG: Request URL:', url);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: '@cf/stabilityai/stable-diffusion-xl-lightning-1x',
            prompt: prompt
        })
    });
    
    console.log('DEBUG: Cloudflare response status:', response.status);
    const data = await response.json();
    console.log('DEBUG: Cloudflare response data:', JSON.stringify(data).substring(0, 200));
    
    if (!response.ok || data.errors) {
        throw new Error(data.errors?.[0]?.message || `Cloudflare API error: ${response.status}`);
    }
    
    console.log('DEBUG: Cloudflare result:', data.result ? 'has result' : 'no result');
    return data.result?.image;
}

// MiniMax Image Generation
async function generateWithMiniMax(prompt, apiKey) {
    console.log('DEBUG: generateWithMiniMax called');
    console.log('DEBUG: Token exists:', !!apiKey, apiKey ? apiKey.substring(0, 10) + '...' : 'none');
    
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
    
    console.log('DEBUG: MiniMax response status:', response.status);
    const data = await response.json();
    console.log('DEBUG: MiniMax response data:', JSON.stringify(data).substring(0, 200));
    
    if (data.base_resp?.status_code === 0 && data.data?.image_urls?.[0]) {
        console.log('DEBUG: MiniMax success, URL:', data.data.image_urls[0]);
        return { type: 'url', url: data.data.image_urls[0] };
    }
    
    throw new Error(data.base_resp?.status_msg || 'MiniMax failed');
}

// Gemini Image Generation
async function generateWithGemini(prompt, apiKey) {
    console.log('DEBUG: generateWithGemini called');
    console.log('DEBUG: Token exists:', !!apiKey, apiKey ? apiKey.substring(0, 10) + '...' : 'none');
    
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
    
    console.log('DEBUG: Gemini response status:', response.status);
    const data = await response.json();
    console.log('DEBUG: Gemini response data:', JSON.stringify(data).substring(0, 200));
    
    if (data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
        console.log('DEBUG: Gemini success');
        return {
            type: 'base64',
            data: data.candidates[0].content.parts[0].inlineData.data
        };
    }
    
    throw new Error('Gemini generation failed');
}

export default async function handler(req, res) {
    console.log('DEBUG: Handler called, method:', req.method);
    console.log('DEBUG: Request body:', JSON.stringify(req.body));
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    // Read environment variables
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const PASSWORD = process.env.APP_PASSWORD;
    
    console.log('DEBUG: Environment variables:');
    console.log('  CLOUDFLARE_API_TOKEN:', CLOUDFLARE_API_TOKEN ? 'SET (' + CLOUDFLARE_API_TOKEN.substring(0, 10) + '...)' : 'NOT SET');
    console.log('  CLOUDFLARE_ACCOUNT_ID:', CLOUDFLARE_ACCOUNT_ID ? 'SET (' + CLOUDFLARE_ACCOUNT_ID + ')' : 'NOT SET');
    console.log('  MINIMAX_API_KEY:', MINIMAX_API_KEY ? 'SET (' + MINIMAX_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
    console.log('  GEMINI_API_KEY:', GEMINI_API_KEY ? 'SET (' + GEMINI_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
    console.log('  APP_PASSWORD:', PASSWORD ? 'SET' : 'NOT SET');
    
    if (!PASSWORD) return res.status(500).json({ error: 'Password not set' });
    
    const { password, prompt } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    
    console.log('DEBUG: Password check:', password === PASSWORD ? 'OK' : 'FAILED');
    if (password !== PASSWORD) {
        return res.status(401).json({ error: 'Password incorrect' });
    }
    
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    if (!prompt) return res.status(400).json({ error: 'No prompt provided' });
    if (prompt.length > 200) return res.status(400).json({ error: 'Prompt too long' });
    if (!checkContent(prompt)) return res.status(400).json({ error: 'Prompt contains blocked content' });
    
    let lastError = null;
    const debug = {
        env: {
            cloudflare: !!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID),
            minimax: !!MINIMAX_API_KEY,
            gemini: !!GEMINI_API_KEY
        },
        envDetail: {
            cloudflareToken: CLOUDFLARE_API_TOKEN ? 'SET' : 'NOT SET',
            cloudflareAccountId: CLOUDFLARE_ACCOUNT_ID ? 'SET' : 'NOT SET',
            minimaxKey: MINIMAX_API_KEY ? 'SET' : 'NOT SET',
            geminiKey: GEMINI_API_KEY ? 'SET' : 'NOT SET',
            appPassword: PASSWORD ? 'SET' : 'NOT SET'
        }
    };
    
    // 1. Cloudflare Workers AI (Stable Diffusion XL Lightning)
    if (CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID) {
        console.log('DEBUG: Attempting Cloudflare...');
        try {
            const result = await generateWithCloudflare(prompt, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID);
            if (result) {
                console.log('DEBUG: Cloudflare SUCCESS');
                return res.status(200).json({
                    success: true,
                    image_data: result,
                    source: 'cloudflare-sdxl-lightning'
                });
            }
        } catch (error) {
            console.log('DEBUG: Cloudflare FAILED:', error.message);
            lastError = 'Cloudflare: ' + error.message;
        }
    } else {
        console.log('DEBUG: Skipping Cloudflare - missing token or account ID');
    }
    
    // 2. MiniMax
    if (MINIMAX_API_KEY) {
        console.log('DEBUG: Attempting MiniMax...');
        try {
            const result = await generateWithMiniMax(prompt, MINIMAX_API_KEY);
            console.log('DEBUG: MiniMax SUCCESS');
            return res.status(200).json({
                success: true,
                image_url: result.url,
                source: 'minimax'
            });
        } catch (error) {
            console.log('DEBUG: MiniMax FAILED:', error.message);
            lastError = 'MiniMax: ' + error.message;
        }
    } else {
        console.log('DEBUG: Skipping MiniMax - no API key');
    }
    
    // 3. Gemini (failover)
    if (GEMINI_API_KEY) {
        console.log('DEBUG: Attempting Gemini...');
        try {
            const result = await generateWithGemini(prompt, GEMINI_API_KEY);
            console.log('DEBUG: Gemini SUCCESS');
            return res.status(200).json({
                success: true,
                image_data: result.data,
                source: 'gemini'
            });
        } catch (error) {
            console.log('DEBUG: Gemini FAILED:', error.message);
            lastError = 'Gemini: ' + error.message;
        }
    } else {
        console.log('DEBUG: Skipping Gemini - no API key');
    }
    
    // All failed
    console.log('DEBUG: ALL SERVICES FAILED');
    console.log('DEBUG: Last error:', lastError);
    
    return res.status(503).json({
        error: 'All image services unavailable',
        debug: debug,
        lastError: lastError
    });
}
