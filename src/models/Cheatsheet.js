const mongoose = require('mongoose');

const cheatsheetSchema = new mongoose.Schema({
    topic: { type: String, required: true, unique: true },
    content: { type: String, required: true }
});

module.exports = mongoose.model('Cheatsheet', cheatsheetSchema);
