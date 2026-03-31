const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

async function askAI(prompt, isJSON = false) {
    // 1. Try Gemini directly
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log("Attempting Gemini API...");
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const result = await model.generateContent(prompt);
            let responseText = result.response.text().trim();
            
            if (isJSON) {
                if (responseText.startsWith('```json')) responseText = responseText.substring(7);
                if (responseText.startsWith('```')) responseText = responseText.substring(3);
                if (responseText.endsWith('```')) responseText = responseText.substring(0, responseText.length - 3);  
            }
            return responseText.trim();
        } catch (e) {
            console.error("Gemini failed:", e.message);
        }
    }

    // 2. Try DeepSeek (High Quality / Paid)
    if (process.env.DEEPSEEK_API_KEY) {
        try {
            console.log("Attempting DeepSeek API...");
            const payload = {
                model: "deepseek-chat",
                messages: [{ role: "user", content: prompt }]
            };
            if (isJSON) payload.response_format = { type: "json_object" };

            const res = await axios.post("https://api.deepseek.com/chat/completions", payload, {
                headers: { "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` }
            });
            return res.data.choices[0].message.content.trim();
        } catch (e) {
            console.error("DeepSeek failed:", e.message);
        }
    }

    // 3. Try OpenRouter (Free Forever Tier via Gemini mirror)
    if (process.env.OPENROUTER_API_KEY) {
        try {
            console.log("Attempting OpenRouter API...");
            const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://localhost:3000",
                    "X-Title": "Discord Bot"
                }
            });
            
            let responseText = res.data.choices[0].message.content.trim();
            
            if (isJSON) {
                if (responseText.startsWith('```json')) responseText = responseText.substring(7);
                if (responseText.startsWith('```')) responseText = responseText.substring(3);
                if (responseText.endsWith('```')) responseText = responseText.substring(0, responseText.length - 3);  
            }
            return responseText.trim();
            
        } catch (e) {
            console.error("OpenRouter failed:", e.message);
        }
    }
    
    throw new Error("All AI API integrations failed to respond.");
}

module.exports = { askAI };
