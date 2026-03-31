const mongoose = require('mongoose');

const BattleSessionSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    questions: { type: Array, required: true }, // Array of question objects
    createdAt: { type: Date, default: Date.now, expires: 3600 } // Auto-deletes after 1 hour
});

module.exports = mongoose.model('BattleSession', BattleSessionSchema);