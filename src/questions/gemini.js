const { GoogleGenerativeAI } = require("@google/generative-ai");
const { askAI } = require("./fallbackAI");
require('dotenv').config();

async function getGeminiBattleQuestions() {
    try {
        const prompt = `
Generate a strict JSON array containing exactly 20 advanced multiple choice questions.
The questions must be strictly from these topics: System Design, Development, Competitive Programming (CP), Data Structures and Algorithms (DSA), DBMS, Operating Systems (OS), Artificial Intelligence (AI), Machine Learning (ML), Deep Learning (DL), OOPS, Data Mining, Data Science.

Make the options concise but factual.

Use this EXACT JSON schema for each object in the array:
[
  {
    "category": "Topic Name",
    "question": "What is the primary difference between a process and a thread?",
    "options": ["Option 1 text", "Option 2 text", "Option 3 text", "Option 4 text"],
    "exactAnswer": "Option 1 text",
    "explanation": "Brief explanation of why this is correct."
  }
]

CRITICAL RULES:
1. "exactAnswer" MUST strictly match one of the exactly strings inside the "options" array.
2. Return ONLY the JSON array. Do NOT wrap in markdown block quotes (\`\`\`json).
        `;

        const responseText = await askAI(prompt, true);
        const parsed = JSON.parse(responseText.trim());

        return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        console.error("AI API Error:", error.message);
    }
}

module.exports = { getGeminiBattleQuestions };

async function getGeminiCheatsheet(topic) {
    try {
        const prompt = 'You are an expert technical instructor. Create a very comprehensive, detailed cheatsheet covering ALL major concepts, principles, formulas, and code structures for the subject: ' + topic + '. Ensure it is long enough to act as a proper study guide for someone preparing for an exam or interview. Use Markdown for formatting (headers, bullet points, code blocks). Do not limit the length.';
        return await askAI(prompt, false);
    } catch (e) {
        console.error('AI error:', e.message);
        return 'Failed to generate cheatsheet.';
    }
}

async function analyzeResumeForInterview(resumeText) {
    try {
        const prompt = 'You are an expert technical interviewer and recruiter.\n' +
                       'Please analyze this resume and generate 5 highly personalized, challenging interview questions based on their skills.\n' +
                       'Format the output clearly in markdown:\n1. 🌟 Strongest apparent skill\n2. 🎯 The 5 custom interview questions.\n3. 🚩 One potential red flag or weak spot based on the resume.\n\nHere is the resume:\n' + resumeText; 
        return await askAI(prompt, false);
    } catch (e) { 
        return 'Failed to analyze resume'; 
    }
}

async function reviewUserCode(userCode) {
    try {
        const prompt = 'You are a Senior Staff Software Engineer performing a rigorous code review.\n' +
                       'Analyze this code and provide incredibly concise markdown feedback:\n### 🐛 Bug Detection\n### ⏱️ Time & Space Complexity\n### 🚀 Optimization Suggestions\n### 🧹 Clean Code Improvements\n\nHere is the code:\n' + userCode;
        return await askAI(prompt, false);
    } catch (e) { 
        return 'Failed to review code'; 
    }
}

module.exports = { getGeminiBattleQuestions, getGeminiCheatsheet, analyzeResumeForInterview, reviewUserCode };