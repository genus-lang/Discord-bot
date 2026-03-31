const mongoose = require('mongoose');

const doubtSchema = new mongoose.Schema({
    askerId: { type: String, required: true },
    askerName: { type: String, required: true },
    question: { type: String, required: true },
    status: { type: String, default: 'Open' },
    messageId: { type: String } // Discord message ID of the generated post
}, { timestamps: true });

module.exports = mongoose.model('Doubt', doubtSchema);