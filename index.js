require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  EmbedBuilder, 
  PermissionFlagsBits 
} = require('discord.js');
const mongoose = require('mongoose');
const Parser = require('rss-parser'); 
const { GoogleGenAI } = require('@google/genai');

// ==========================================
// 1. INITIALIZATION & CONFIGURATION
// ==========================================
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 2. DATABASE SCHEMA (For Multi-Server Settings)
// ==========================================
// This replaces the hardcoded CONFIG. Server owners can now set their own channels.
const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: '!' },
  announceChannelId: { type: String, default: null },
  logsChannelId: { type: String, default: null },
  aiChannelId: { type: String, default: null },
  ytNotifChannelId: { type: String, default: null },
  twitterNotifChannelId: { type: String, default: null },
  tiktokNotifChannelId: { type: String, default: null },
});
const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);

// Memory cache for RSS trackers
let lastYtVideoId = '';
let lastTweetId = '';
let lastTikTokId = '';

// AI System Knowledge
const aiSystemInstruction = `
You are an advanced AI Assistant integrated into a Premium Discord Bot. 
Your primary knowledge revolves around a Minecraft Bedrock Addon project named "UMAMUSUME SERIE: GOLDEN ERA".
When a user asks about you or this project, you must introduce yourself and state:
- The Architect & Lead Coder is M4Lych MC.
- The Artist and Creative Director is Miriella Airi.
- The project brings complex JSON UI architectures, custom 3D animations, and Uma Musume racing mechanics to Minecraft.
Respond helpfully in English or the user's preferred language.
`;

// ==========================================
// COMMAND: !setup (Membuka Menu Interaktif)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.toLowerCase() === '!setup') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Only Administrators can configure bot settings!');
    }

    const embed = new EmbedBuilder()
      .setTitle('🛠️ Bot Control Panel')
      .setDescription(
        'Welcome to the interactive configuration panel!\n\n' +
        'Select a feature below to configure its designated channel for this server.'
      )
      .setColor('#FFD700')
      .setFooter({ text: 'UMAMUSUME SERIE: GOLDEN ERA Management' });

    // Membuat Dropdown Menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('dashboard_select_channel')
      .setPlaceholder('📌 Select feature to configure...')
      .addOptions([
        {
          label: 'Announcement Channel',
          description: 'Set channel for server announcements',
          value: 'channel_announce',
          emoji: '📢'
        },
        {
          label: 'Audit & AutoMod Logs',
          description: 'Set channel for deleted messages and moderation logs',
          value: 'channel_logs',
          emoji: '📜'
        },
        {
          label: 'Gemini AI Assistant',
          description: 'Set dedicated channel for AI chat queries',
          value: 'channel_ai',
          emoji: '🤖'
        },
        {
          label: 'YouTube Notifications',
          description: 'Set channel for new YouTube uploads',
          value: 'channel_yt',
          emoji: '🎥'
        }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await message.reply({ embeds: [embed], components: [row] });
  }
});

// ==========================================
// INTERACTION HANDLER (Dropdown & Buttons)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId === 'dashboard_select_channel') {
    const selectedFeature = interaction.values[0];
    
    // Ambil setting server dari MongoDB
    let config = await GuildConfig.findOne({ guildId: interaction.guild.id });
    if (!config) config = await GuildConfig.create({ guildId: interaction.guild.id });

    let title = '';
    let description = '';

    if (selectedFeature === 'channel_announce') {
      title = '📢 Configure Announcement Channel';
      description = 'Type `!setchannel announce #channel` in any channel to update this setting.';
    } else if (selectedFeature === 'channel_logs') {
      title = '📜 Configure Audit Logs Channel';
      description = 'Type `!setchannel logs #channel` in any channel to update this setting.';
    } else if (selectedFeature === 'channel_ai') {
      title = '🤖 Configure AI Chat Channel';
      description = 'Type `!setchannel ai #channel` in any channel to update this setting.';
    } else if (selectedFeature === 'channel_yt') {
      title = '🎥 Configure YouTube Notif Channel';
      description = 'Type `!setchannel youtube #channel` in any channel to update this setting.';
    }

    const responseEmbed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor('#5865F2');

    // Mengirim balasan ephemeral (hanya bisa dilihat oleh admin yang menekan)
    await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
  }
});

// ==========================================
// 3. BOT EVENTS
// ==========================================
client.once('ready', () => {
  console.log(`🤖 Bot online: ${client.user.tag}`);

  // Check RSS Feeds every 5 minutes
  setInterval(() => {
    checkYouTubeUpdates();
    checkTwitterUpdates();
    checkTikTokUpdates();
  }, 5 * 60 * 1000); 
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Fetch server settings from Database (Create if it doesn't exist)
  let config = await GuildConfig.findOne({ guildId: message.guild.id });
  if (!config) {
    config = await GuildConfig.create({ guildId: message.guild.id });
  }

  const text = message.content.toLowerCase();

  // --- FEATURE: AUTO MODERATION ---
  const badWords = ['nigga', 'fuck', 'anjing']; 
  const hasBadWord = badWords.some(word => text.includes(word));
  if (hasBadWord) {
    await message.delete().catch(() => {});
    const warnMsg = await message.channel.send(`${message.author}, Your message has been deleted due to inappropriate language!`);
    
    // Log to the server's custom logs channel if configured
    if (config.logsChannelId) {
      const logChannel = message.guild.channels.cache.get(config.logsChannelId);
      if (logChannel) logChannel.send(`⚠️ AutoMod: Deleted message from ${message.author.tag} in <#${message.channel.id}>`);
    }
    
    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
    return;
  }

  // --- FEATURE: SETUP COMMANDS (For Server Owners) ---
  if (text.startsWith(`${config.prefix}setchannel`)) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Administrator only!');
    }
    
    const args = message.content.split(' ');
    const type = args[1]?.toLowerCase(); // e.g., announce, logs, ai
    const targetChannel = message.mentions.channels.first();

    if (!type || !targetChannel) {
      return message.reply(`Usage: \`${config.prefix}setchannel <announce|logs|ai|youtube|twitter|tiktok> #channel\``);
    }

    if (type === 'announce') config.announceChannelId = targetChannel.id;
    else if (type === 'logs') config.logsChannelId = targetChannel.id;
    else if (type === 'ai') config.aiChannelId = targetChannel.id;
    
    await config.save();
    return message.reply(`✅ Successfully set the **${type}** channel to ${targetChannel}`);
  }

  // --- FEATURE: ANNOUNCEMENT ---
  if (text.startsWith(`${config.prefix}announce`)) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ You do not have permission to use this command!');
    }

    const args = message.content.slice(config.prefix.length + 8).trim();
    const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(config.announceChannelId);
    
    if (!targetChannel) return message.reply('❌ No announcement channel set! Mention a channel or set one up first.');

    let announceText = args.replace(/<#\d+>/, '').trim();
    const attachment = message.attachments.first();

    if (!announceText && !attachment) {
      return message.reply('⚠️ Invalid format! Use: `!announce #channel Your message here` (Image uploads supported!)');
    }

    const embed = new EmbedBuilder()
      .setTitle('📢 ANNOUNCEMENT')
      .setColor('#FF0000')
      .setFooter({ text: `Posted by: ${message.author.username}` })
      .setTimestamp();

    if (announceText.length > 0) embed.setDescription(announceText);
    if (attachment && attachment.contentType?.startsWith('image/')) embed.setImage(attachment.url);

    await targetChannel.send({ embeds: [embed] });
    return message.reply(`✅ Announcement sent to ${targetChannel}!`);
  }

  // --- FEATURE: GEMINI AI ---
  const isMentioned = message.mentions.has(client.user);
  const isAiChannel = message.channel.id === config.aiChannelId;

  if (isMentioned || isAiChannel) {
    await message.channel.sendTyping();
    try {
      const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
      const messages = await message.channel.messages.fetch({ limit: 10 });
      
      const chatHistory = messages
        .filter(msg => msg.content && msg.content.trim().length > 0) 
        .filter(msg => msg.id !== message.id) 
        .reverse()
        .map(msg => ({
          role: msg.author.id === client.user.id ? 'model' : 'user',
          parts: [{ text: msg.content.replace(`<@${client.user.id}>`, '').trim() }]
        }));

      // Initiating chat with the specified model and knowledge base
      const chat = ai.chats.create({
        model: 'gemini-3.5-flash-lite',
	config: {
 	tools: [{ googleSearch: {} }]
	},
        history: chatHistory
      });

      const result = await chat.sendMessage({ message: prompt || 'Hello!' });
      return message.reply(result.text);

    } catch (err) {
      console.log('--- ERROR GEMINI ---', err); 
      return message.reply('⚠️ The AI system is currently experiencing issues.');
    }
  }
});

// ==========================================
// 4. RSS NOTIFICATIONS (YouTube, Twitter, TikTok)
// ==========================================
// Note: To make this multi-server, you would loop through all GuildConfigs in the database
// and send messages to servers that have configured their 'ytNotifChannelId', etc.

async function checkYouTubeUpdates() {
  const ytChannelUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=UCLXgvJ590t3-FOVXxpRD0bw`; 
  try {
    const feed = await parser.parseURL(ytChannelUrl);
    if (feed.items.length > 0 && feed.items[0].id !== lastYtVideoId) {
      lastYtVideoId = feed.items[0].id;
      // Example of fetching servers from DB that want this notification
      const servers = await GuildConfig.find({ ytNotifChannelId: { $ne: null } });
      servers.forEach(server => {
        const channel = client.channels.cache.get(server.ytNotifChannelId);
        if (channel) channel.send(`🎥 **New Video!**\n**${feed.items[0].title}**\n${feed.items[0].link}`);
      });
    }
  } catch (err) { console.error('YouTube RSS Error:', err.message); }
}

async function checkTwitterUpdates() {
  const twitterUrl = 'https://openrss.org/x.com/@umamusume_eng';
  try {
    const feed = await parser.parseURL(twitterUrl);
    if (feed.items.length > 0 && feed.items[0].guid !== lastTweetId) {
      lastTweetId = feed.items[0].guid;
      const servers = await GuildConfig.find({ twitterNotifChannelId: { $ne: null } });
      servers.forEach(server => {
        const channel = client.channels.cache.get(server.twitterNotifChannelId);
        if (channel) channel.send(`🐦 **New Tweet!**\n${feed.items[0].link}`);
      });
    }
  } catch (err) { console.error('Twitter RSS Error:', err.message); }
}

async function checkTikTokUpdates() {
  // TikTok doesn't have official RSS. You usually need a service like ProxiTok or RSSHub.
  // Example using RSSHub format for a specific user:
  const tiktokUrl = 'https://rsshub.app/tiktok/user/@umamusu_pd'; 
  try {
    const feed = await parser.parseURL(tiktokUrl);
    if (feed.items.length > 0 && feed.items[0].guid !== lastTikTokId) {
      lastTikTokId = feed.items[0].guid;
      const servers = await GuildConfig.find({ tiktokNotifChannelId: { $ne: null } });
      servers.forEach(server => {
        const channel = client.channels.cache.get(server.tiktokNotifChannelId);
        if (channel) channel.send(`📱 **New TikTok!**\n${feed.items[0].link}`);
      });
    }
  } catch (err) { console.error('TikTok RSS Error:', err.message); }
}

const session = require('express-session');
const axios = require('axios');

// Set middleware Express untuk Session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 } // Sesi berlaku 1 jam
}));

// ==========================================
// WEB DASHBOARD OAUTH2 & GATEKEEPER
// ==========================================

// 1. Route Login Discord
app.get('/login', (req, res) => {
  const redirectUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(redirectUrl);
});

// 2. Route Callback setelah User Klik "Authorize" di Discord
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('❌ Authentication failed! No code provided.');

  try {
    // Tukarkan 'code' dengan Access Token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.REDIRECT_URI,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;

    // Ambil data Profile User
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Ambil daftar Guild (Server) yang diikuti User
    const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Simpan ke Session Web
    req.session.user = userResponse.data;
    req.session.guilds = guildsResponse.data;

    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth2 Error:', error.response?.data || error.message);
    res.send('❌ Error during authentication.');
  }
});

// 3. Halaman Dashboard Utama (Dengan Gatekeeper Premium)
app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const user = req.session.user;
  const userGuilds = req.session.guilds || [];

  // SYSTEM GATEKEEPER: Cek apakah User ada di Server milik Creator
  const isInCreatorServer = userGuilds.some(guild => guild.id === process.env.GUILD_ID_CREATOR);

  // Jika User BELUM Join Server Creator -> BLOCK!
  if (!isInCreatorServer) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Access Denied - Premium Bot</title>
        <style>
          body { font-family: Arial, sans-serif; background: #0f0f13; color: white; text-align: center; padding-top: 100px; }
          .card { background: #1a1a24; max-width: 450px; margin: auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
          .btn { background: #5865F2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-top: 20px; }
          .btn:hover { background: #4752C4; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔒 Premium Access Required</h2>
          <p>Hello <b>${user.username}</b>!</p>
          <p>To configure this bot or invite it to your server, you must be a member of the Creator's Official Support Server.</p>
          <a class="btn" href="https://discord.gg/LINK_INVITE_SERVER_KAMU" target="_blank">Join Creator's Server</a>
          <br><br>
          <a href="/login" style="color: #aaa; font-size: 12px;">Re-check Access</a>
        </div>
      </body>
      </html>
    `);
  }

  // Jika LOLOS (User SUDAH ada di Server Creator) -> Tampilkan Dashboard!
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Dashboard - UMAMUSUME SERIE Bot</title>
      <style>
        body { font-family: Arial, sans-serif; background: #0f0f13; color: white; text-align: center; padding-top: 50px; }
        .card { background: #1a1a24; max-width: 600px; margin: auto; padding: 30px; border-radius: 12px; }
        .btn-invite { background: #24252d; color: #5865F2; border: 1px solid #5865F2; padding: 10px 20px; text-decoration: none; border-radius: 6px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Welcome to Dashboard, ${user.username}! 🎉</h1>
        <p>✅ Access Granted (Verified Member of Official Server)</p>
        <hr style="border-color: #333;">
        <h3>Your Manageable Servers:</h3>
        <p>Here you can manage channels, notifications (YouTube, X, TikTok), and Bot Settings.</p>
        <br>
        <a class="btn-invite" href="https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot" target="_blank">➕ Add Bot to Your Server</a>
      </div>
    </body>
    </html>
  `);
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});
app.listen(PORT, () => {
  console.log(`🌐 Web Dashboard Server is running on port ${PORT}`);
});
client.login(process.env.DISCORD_TOKEN);
