const axios = require('axios');

async function getLeetCodeDaily() {
  try {
    const response = await axios.get('https://alfa-leetcode-api.onrender.com/daily');
    const data = response.data;
    
    if (data && data.questionTitle) {
      let diffEmoji = "🟢 Easy";
      if (data.difficulty === "Medium") diffEmoji = "🟡 Medium";
      if (data.difficulty === "Hard") diffEmoji = "🔴 Hard";

      const topicTags = data.topicTags || [];
      const topic = topicTags.map(t => t.name).join(', ') || "DSA";

      return {
        title: `LeetCode Daily: ${data.questionTitle}`,
        difficulty: diffEmoji,
        topic: topic,
        question: `Check out today's LeetCode Daily Question!`,
        example: "See the link for examples and constraints.",
        hint: "Read the problem carefully and think about time complexity.",
        link: data.questionLink
      };
    }
  } catch (error) {
    console.error("Error fetching LeetCode daily:", error.message);
  }
  return null;
}

async function getCodeforcesRandom() {
  try {
    const response = await axios.get('https://codeforces.com/api/problemset.problems');
    const problems = response.data?.result?.problems;
    if (problems && problems.length > 0) {
      const p = problems[Math.floor(Math.random() * problems.length)];
      return {
        title: `Codeforces: ${p.name}`,
        difficulty: p.rating ? `⭐ Rating: ${p.rating}` : "⚪ Unrated",
        topic: p.tags.length > 0 ? p.tags.join(', ') : "Competitive Programming",
        question: `A random Competitive Programming challenge from Codeforces!`,
        example: "Click the link to view input/output samples.",
        hint: "Consider edge cases and optimal data structures.",
        link: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
      };
    }
  } catch (error) {
    console.error("Error fetching Codeforces:", error.message);
  }
  return null;
}

async function getCodingQuestion() {
  // Randomly choose between LeetCode daily and a random Codeforces problem
  const useLeetCode = Math.random() < 0.5;
  let q = null;
  
  if (useLeetCode) {
    q = await getLeetCodeDaily();
    if (!q) q = await getCodeforcesRandom();
  } else {
    q = await getCodeforcesRandom();
    if (!q) q = await getLeetCodeDaily();
  }
  
  if (q) return q;

  // Fallback
  return {
    title: "LeetCode: Two Sum",
    difficulty: "🟢 Easy",
    topic: "Arrays / HashMap",
    question: "Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.",
    example: "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]",
    hint: "Use a HashMap to store visited values and their indices.",
    link: "https://leetcode.com/problems/two-sum/"
  };
}

module.exports = { getCodingQuestion };
