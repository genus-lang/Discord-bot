const mongoose = require('mongoose');

async function connectDB() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn("MongoDB URI is missing in .env!");
      return;
    }
    await mongoose.connect(uri);
    console.log("? MongoDB Connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

module.exports = { connectDB };
