const mongoose = require('mongoose');

const AIQuestionSchema = new mongoose.Schema({
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctAnswer: { type: String, required: true }, // Should match one of the options
    explanation: { type: String },
    category: { type: String, default: 'General' },
    difficulty: { type: String, default: 'Medium' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AIQuestion', AIQuestionSchema);
