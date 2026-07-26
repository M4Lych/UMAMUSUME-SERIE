require('dotenv').config();
const mongoose = require('mongoose');
const startBot = require('./bot/bot');
const startDashboard = require('./dashboard/app');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB!');
    // Start bot and dashboard after DB connection
    startBot();
    startDashboard();
  })
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));
