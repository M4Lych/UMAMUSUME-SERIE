const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: '!' },
  
  // Channels
  welcomeChannelId: { type: String, default: null },
  announceChannelId: { type: String, default: null },
  logsChannelId: { type: String, default: null },
  aiChannelId: { type: String, default: null },
  minigameChannelId: { type: String, default: null },
  
  // Minigame Settings
  minigameImage: { type: String, default: 'https://i.imgur.com/example.jpg' },
  minigameAnswer: { type: String, default: 'special week' },
  
  // Custom Trackers (Per Server)
  ytTrackId: { type: String, default: null },
  ytChannelId: { type: String, default: null },
  lastYtVideoId: { type: String, default: null },
  
  twitterTrackId: { type: String, default: null },
  twitterChannelId: { type: String, default: null },
  lastTweetId: { type: String, default: null },
  
  tiktokTrackId: { type: String, default: null },
  tiktokChannelId: { type: String, default: null },
  lastTikTokId: { type: String, default: null },
  
  // Moderation & Roles
  autoRoleIds: { type: [String], default: [] },
  allowedLinkRoles: { type: [String], default: [] },
  
  // Maps
  autoResponder: { type: Map, of: String, default: {} },
  reactionRoles: { type: Map, of: String, default: {} },
});

const UserStatsSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  fans: { type: Number, default: 0 },
  coins: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 }
});

module.exports = {
  GuildConfig: mongoose.model('GuildConfig', GuildConfigSchema),
  UserStats: mongoose.model('UserStats', UserStatsSchema)
};
