const axios = require('axios');
const { askAI } = require('./fallbackAI');
require('dotenv').config();

async function getOpenTDBQuestion() {
  try {
    const category = 18; // 18=Computers
    const response = await axios.get(`https://opentdb.com/api.php?amount=1&category=${category}&type=multiple`);
    const data = response.data;

    if (data.results && data.results.length > 0) {
      const q = data.results[0];
      const categoryEmoji = "💻 Trivia: Computers";

      const difficultyMap = { // Mapping OpenTDB difficulty
        "easy": "🟢 Easy",
        "medium": "🟡 Medium",
        "hard": "🔴 Hard"
      };

      const options = [...q.incorrect_answers, q.correct_answer];
      options.sort(() => Math.random() - 0.5); // Shuffle options

      const formattedQuestion = q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const correctAnswer = q.correct_answer.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

      return {
        type: "OpenTDB API",
        category: categoryEmoji,
        difficulty: difficultyMap[q.difficulty] || "💻 Medium",
        question: `**${formattedQuestion}**\n\n**Options:**\n` + options.map((opt, i) => `${i + 1}. ${opt.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')}`).join('\n'),
        advice: `Take a guess! The correct answer is hidden. ||**${correctAnswer}**||`,
        exactAnswer: correctAnswer,
        optionsList: options.map(opt => opt.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
      };
    }
  } catch (error) {
    console.error("Error fetching OpenTDB trivia:", error.message);
  }
  return null;
}

async function getQuizApiQuestion() {
  try {
    const apiKey = process.env.QUIZAPI_KEY;
    if (!apiKey) return null;

    const response = await axios.get(`https://quizapi.io/api/v1/questions?limit=1&api_key=${apiKey}`);

    const resData = response.data;
    if (resData && resData.success && resData.data && resData.data.length > 0) {
      const q = resData.data[0];
      
      const difficultyMap = {
        "EASY": "🟢 Easy",
        "MEDIUM": "🟡 Medium",
        "HARD": "🔴 Hard"
      };

      let correctText = "Unknown";
      let optionsStr = "";
      let optionsList = [];
      
      if (Array.isArray(q.answers)) {
          q.answers.forEach((ans, idx) => {
              optionsStr += `${idx + 1}. ${ans.text}\n`;
              optionsList.push(ans.text);
              if (ans.isCorrect) {
                  correctText = ans.text;
              }
          });
      }

      return {
        type: "QuizAPI.io",
        category: `💻 ${q.category || "Programming"}`,
        difficulty: difficultyMap[q.difficulty?.toUpperCase()] || "🟡 Medium",
        question: `**${q.text}**\n\n**Options:**\n${optionsStr}`,
        advice: q.explanation 
          ? `Correct Answer: ||**${correctText}**||\n*Explanation:* ${q.explanation}`
          : `Correct Answer: ||**${correctText}**||`,
        exactAnswer: correctText,
        optionsList: optionsList
      };
    }
  } catch (error) {
    console.error("Error fetching QuizAPI:", error.message);
  }
  return null;
}

async function getApiNinjasQuestion() {
  try {
    const apiKey = process.env.APININJAS_KEY;
    if (!apiKey) return null;

    // Pick between riddles and trivia
    const useRiddle = Math.random() < 0.5;
    const endpoint = useRiddle ? 'https://api.api-ninjas.com/v1/riddles' : 'https://api.api-ninjas.com/v1/trivia';
    
    const response = await axios.get(endpoint, {
      headers: { 'X-Api-Key': apiKey }
    });

    const data = response.data;
    if (data && data.length > 0) {
      const q = data[0];
      
      return {
        type: "API-Ninjas",
        category: useRiddle ? "🧩 Riddle" : `📜 Trivia: ${q.category}`,
        difficulty: "🟡 Medium",
        question: `**${q.question}**`,
        advice: `The answer is... ||**${q.answer}**||`,
        exactAnswer: q.answer,
        optionsList: []
      };
    }
  } catch (error) {
    console.error("Error fetching API-Ninjas:", error.message);
  }
  return null;
}

// -------------------------------------------------------------
// MAIN EXPORT
// -------------------------------------------------------------
async function getInterviewQuestion() {
  const rand = Math.random();
  let q = null;

  // Randomize between the 3 APIs
  if (rand < 0.3) {
    q = await getQuizApiQuestion();
    if (!q) q = await getApiNinjasQuestion();
    if (!q) q = await getOpenTDBQuestion();
  } else if (rand < 0.6) {
    q = await getApiNinjasQuestion();
    if (!q) q = await getOpenTDBQuestion();
    if (!q) q = await getQuizApiQuestion();
  } else {
    q = await getOpenTDBQuestion();
    if (!q) q = await getQuizApiQuestion();
    if (!q) q = await getApiNinjasQuestion();
  }

  // AI Fallback
  if (!q) {
    try {
      const prompt = `Generate a high-quality coding interview question on Data Structures or System Design. 
      Format strictly in JSON: {"question": "...", "category": "Topic", "difficulty": "Hard/Medium/Easy", "answer": "..."}`;
      
      const responseText = await askAI(prompt, true);
      if (responseText) {
          const parsed = JSON.parse(responseText.trim());
          q = {
            type: "AI Generated",
            category: `📚 ${parsed.category || 'CS Concepts'}`,
            difficulty: `🔥 ${parsed.difficulty || 'Medium'}`,
            question: `**${parsed.question}**`,
            advice: `Take a guess! The correct answer is... ||**${parsed.answer}**||`,
            exactAnswer: parsed.answer,
            optionsList: []
          };
      }
    } catch (e) {
      console.error("AI Fallback failed:", e.message);
    }
  }

  // Very last fallback in case ALL APIs are down or quotas are hit
  if (!q) {
    return {
      type: "Emergency Fallback",
      category: "💻 CS Basics",
      difficulty: "🟡 Medium",
      question: "**What is the time complexity of a Binary Search tree lookup?**\n\n1. O(1)\n2. O(n)\n3. O(log n)\n4. O(n log n)",
      advice: "||**O(log n)**|| in the average case.",
      exactAnswer: "O(log n)",
      optionsList: ["O(1)", "O(n)", "O(log n)", "O(n log n)"]
    };
  }

  return q;
}

module.exports = { getInterviewQuestion };
