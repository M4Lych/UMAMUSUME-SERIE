const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { GuildConfig } = require('../bot/models');

module.exports = function startDashboard() {
  const app = express();
  
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 2 * 60 * 60 * 1000 }
  }));

  // Render Login
  app.get('/', (req, res) => res.render('login'));

  // Auth Redirect
  app.get('/login', (req, res) => {
    const redirectUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(redirectUrl);
  });

  // Auth Callback
  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.render('error', { message: 'Authentication failed! No code provided.' });

    try {
      const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

      const token = tokenRes.data.access_token;

      const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token}` } });
      const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${token}` } });

      req.session.user = userRes.data;
      req.session.guilds = guildsRes.data;

      res.redirect('/dashboard');
    } catch (err) {
      res.render('error', { message: 'OAuth2 Error. Could not authenticate.' });
    }
  });

  // Gatekeeper & Dashboard View
  app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    // Check if user is in Author's Server
    const isVerified = req.session.guilds.some(g => g.id === process.env.AUTHOR_GUILD_ID);
    if (!isVerified) {
      return res.render('error', { message: 'Access Denied! You must join the Official Author Discord Server to use this bot & dashboard.' });
    }

    // Filter guilds where user has MANAGE_GUILD or ADMIN
    const manageableGuilds = req.session.guilds.filter(g => (g.permissions & 0x20) === 0x20 || (g.permissions & 0x8) === 0x8);
    
    res.render('dashboard', { user: req.session.user, guilds: manageableGuilds });
  });

  // Get settings for a specific guild
  app.get('/api/settings/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({error: 'Unauthorized'});
    const config = await GuildConfig.findOne({ guildId: req.params.guildId });
    res.json(config || {});
  });

  // Update Settings API
  app.post('/api/settings/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({error: 'Unauthorized'});
    
    const { guildId } = req.params;
    const body = req.body;

    try {
      let config = await GuildConfig.findOne({ guildId });
      if (!config) config = new GuildConfig({ guildId });

      // Channels
      config.welcomeChannelId = body.welcomeChannelId || null;
      config.announceChannelId = body.announceChannelId || null;
      config.aiChannelId = body.aiChannelId || null;
      config.minigameChannelId = body.minigameChannelId || null;

      // Minigames
      config.minigameImage = body.minigameImage || 'https://i.imgur.com/example.jpg';
      config.minigameAnswer = body.minigameAnswer || 'special week';

      // Social Media Trackers
      config.ytTrackId = body.ytTrackId || null;
      config.ytChannelId = body.ytChannelId || null;
      config.twitterTrackId = body.twitterTrackId || null;
      config.twitterChannelId = body.twitterChannelId || null;
      config.tiktokTrackId = body.tiktokTrackId || null;
      config.tiktokChannelId = body.tiktokChannelId || null;

      // Arrays (comma separated)
      if (body.autoRoleIds) config.autoRoleIds = body.autoRoleIds.split(',').map(s=>s.trim());
      if (body.allowedLinkRoles) config.allowedLinkRoles = body.allowedLinkRoles.split(',').map(s=>s.trim());

      // Maps (parsed from JSON strings in the frontend)
      if (body.autoResponder) {
        try { config.autoResponder = JSON.parse(body.autoResponder); } catch(e){}
      }
      if (body.reactionRoles) {
        try { config.reactionRoles = JSON.parse(body.reactionRoles); } catch(e){}
      }

      await config.save();
      res.json({ success: true, message: 'Settings saved successfully!' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🌐 Dashboard running on port ${PORT}`));
}
