const { GoogleGenerativeAI } = require('@google/generative-ai');

function getAIModel() {
    if (!process.env.GEMINI_API_KEY) {
        console.warn("⚠️ GEMINI_API_KEY is missing in your .env file! AI features won't work.");
        return null;
    }
    
    // Initialize the Gemini API client
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // gemini-2.0-flash is fast, capable, and supports our prompts
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    return model;
}

// Quick test function to ensure the API is working properly
async function testAI(prompt) {
    const model = getAIModel();
    if (!model) return "AI is not configured!";
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (err) {
        console.error("❌ AI Error:", err.message);
        return "Failed to generate AI response.";
    }
}

module.exports = { getAIModel, testAI };