const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    mastery: {
        DSA: { type: Number, default: 0 },
        OS: { type: Number, default: 0 },
        DBMS: { type: Number, default: 0 },
        WebDev: { type: Number, default: 0 },
        CP: { type: Number, default: 0 },
        General: { type: Number, default: 0 }
    },
    battleWins: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', userSchema);