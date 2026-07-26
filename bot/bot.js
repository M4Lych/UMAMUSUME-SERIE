const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits 
} = require('discord.js');
const Parser = require('rss-parser');
const { GoogleGenAI } = require('@google/genai');
const { GuildConfig, UserStats } = require('./models');

function makeEmbed(title, desc, color = '#32cd32') {
  return new EmbedBuilder().setTitle(title).setDescription(desc||null).setColor(color).setTimestamp();
}

module.exports = function startBot() {
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

  const parser = new Parser();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const aiSystemInstruction = `
    You are an advanced AI Assistant integrated into a Discord Bot, operating in 2026.
    Your persona is a highly energetic, dedicated Uma Musume trainer and character.
    Your knowledge is updated up to 2026.
    You assist with technical queries, server management, and fun interactions.
    Always respond politely, maintain your energetic anime persona, and provide accurate information.
  `;

  client.once('clientReady', () => {
    console.log(`🤖 Bot online: ${client.user.tag}`);
    // Check RSS every 10 minutes
    setInterval(() => checkSocialMedia(client, parser), 10 * 60 * 1000);
  });

  // 1. Welcome / Leave
  client.on('guildMemberAdd', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (!config) return;

    // 11. Auto Role
    if (config.autoRoleIds && config.autoRoleIds.length > 0) {
      for (const roleId of config.autoRoleIds) {
        const role = member.guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role).catch(() => {});
      }
    }

    if (config.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(config.welcomeChannelId);
      if (channel) {
        channel.send({ embeds: [
          makeEmbed('👋 Welcome!', `Welcome to the server, <@${member.id}>! Enjoy your stay.`, '#00FF00')
            .setThumbnail(member.user.displayAvatarURL())
        ] });
      }
    }
  });

  client.on('guildMemberRemove', async (member) => {
    const config = await GuildConfig.findOne({ guildId: member.guild.id });
    if (config && config.welcomeChannelId) {
      const channel = member.guild.channels.cache.get(config.welcomeChannelId);
      if (channel) {
        channel.send({ embeds: [makeEmbed('🚪 Goodbye', `**${member.user.tag}** has left the server.`, '#FF0000')] });
      }
    }
  });

  // 12. Reaction Roles
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    const config = await GuildConfig.findOne({ guildId: reaction.message.guild.id });
    if (!config || !config.reactionRoles) return;
    
    // Format map key: messageId_emojiName
    const key = `${reaction.message.id}_${reaction.emoji.name}`;
    const roleId = config.reactionRoles.get(key);
    
    if (roleId) {
      const member = reaction.message.guild.members.cache.get(user.id);
      if (member) {
        await member.roles.add(roleId).catch(() => {});
      }
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    let config = await GuildConfig.findOne({ guildId: message.guild.id });
    if (!config) config = await GuildConfig.create({ guildId: message.guild.id });

    const text = message.content.toLowerCase();

    // 8. Auto Ban Spam Link (Exceptions applied)
    if (text.includes('discord.gg/') || text.includes('discord.com/invite/')) {
      const hasAllowedRole = message.member.roles.cache.some(role => config.allowedLinkRoles.includes(role.id));
      if (!hasAllowedRole && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.delete().catch(() => {});
        await message.member.ban({ reason: 'Spamming unauthorized Discord links' }).catch(() => {});
        
        if (config.logsChannelId) {
          const logChan = message.guild.channels.cache.get(config.logsChannelId);
          if (logChan) logChan.send({ embeds: [makeEmbed('⛔ Auto Ban', `<@${message.author.id}> was banned for spamming invite links.`, '#FF0000')] });
        }
        return message.channel.send({ embeds: [makeEmbed('⛔ Anti-Spam', `<@${message.author.id}> has been banned for sending unauthorized server links.`, '#FF0000')] });
      }
    }

    // 4. Auto Responder
    if (config.autoResponder && config.autoResponder.has(text)) {
      return message.reply({ embeds: [makeEmbed('🤖 Auto Response', config.autoResponder.get(text), '#5865F2')] });
    }

    // 2 & 3. Levelling & Economy
    let stats = await UserStats.findOne({ userId: message.author.id, guildId: message.guild.id });
    if (!stats) stats = await UserStats.create({ userId: message.author.id, guildId: message.guild.id });

    stats.xp += Math.floor(Math.random() * 10) + 5;
    stats.coins += Math.floor(Math.random() * 5) + 1;

    const xpNeeded = stats.level * 150;
    if (stats.xp >= xpNeeded) {
      stats.level += 1;
      stats.fans += Math.floor(Math.random() * 50) + 10;
      stats.xp = 0;
      message.channel.send({ embeds: [
        makeEmbed('🎉 LEVEL UP!', `Congratulations <@${message.author.id}>! You reached **Level ${stats.level}**!\nFans: **${stats.fans}** | Coins: **${stats.coins}**`, '#FFD700')
      ]});
    }
    await stats.save();

    // Stats Command
    if (text === `${config.prefix}profile`) {
      const embed = makeEmbed(`📊 Stats: ${message.author.username}`, '', '#FFD700')
        .addFields(
          { name: '🌟 Level', value: `${stats.level}`, inline: true },
          { name: '✨ XP', value: `${stats.xp}/${stats.level * 150}`, inline: true },
          { name: '👥 Fans', value: `${stats.fans}`, inline: true },
          { name: '🪙 Coins', value: `${stats.coins}`, inline: true }
        )
        .setThumbnail(message.author.displayAvatarURL());
      return message.reply({ embeds: [embed] });
    }

    // 6. Announcement Command
    if (text.startsWith(`${config.prefix}announce `)) {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
      const announceText = message.content.slice(config.prefix.length + 9).trim();
      const targetChannel = config.announceChannelId ? message.guild.channels.cache.get(config.announceChannelId) : message.channel;
      
      const embed = makeEmbed('📢 ANNOUNCEMENT', announceText, '#FF0000').setFooter({ text: `By ${message.author.username}` });
      if (message.attachments.first()) embed.setImage(message.attachments.first().url);
      
      if (targetChannel) targetChannel.send({ embeds: [embed] });
      return message.reply({ embeds: [makeEmbed('✅ Success', 'Announcement sent!', '#00FF00')] });
    }

    // 7. Create Event Command
    if (text.startsWith(`${config.prefix}createevent `)) {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageEvents)) return;
      const eventName = message.content.slice(config.prefix.length + 12).trim();
      try {
        const scheduledEvent = await message.guild.scheduledEvents.create({
          name: eventName,
          scheduledStartTime: new Date(Date.now() + 86400000), // 24 hours from now
          privacyLevel: 2,
          entityType: 3,
          entityMetadata: { location: 'Discord Server' },
          description: 'Auto-generated event.'
        });
        return message.reply({ embeds: [makeEmbed('✅ Event Created', `Event **${scheduledEvent.name}** has been scheduled!`, '#00FF00')] });
      } catch (e) {
        return message.reply({ embeds: [makeEmbed('❌ Error', 'Failed to create event. Make sure I have permissions.', '#FF0000')] });
      }
    }

    // 9. Minigames
    if (text === `${config.prefix}guess`) {
      if (config.minigameChannelId && message.channel.id !== config.minigameChannelId) {
        return message.reply({ embeds: [makeEmbed('❌ Denied', `Play this game in <#${config.minigameChannelId}>`, '#FF0000')] });
      }
      
      const gameEmbed = makeEmbed('🎮 Minigame: Guess The Picture!', 'Guess the name of the character/item below! You have 15 seconds.', '#00FFFF')
        .setImage(config.minigameImage);
      await message.channel.send({ embeds: [gameEmbed] });

      const filter = m => m.content.toLowerCase() === config.minigameAnswer.toLowerCase();
      const collector = message.channel.createMessageCollector({ filter, time: 15000, max: 1 });

      collector.on('collect', async m => {
        let winnerStats = await UserStats.findOne({ userId: m.author.id, guildId: m.guild.id });
        winnerStats.coins += 100;
        await winnerStats.save();
        m.reply({ embeds: [makeEmbed('🎉 Correct!', `<@${m.author.id}> guessed it right and earned **100 Coins**!`, '#00FF00')] });
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          message.channel.send({ embeds: [makeEmbed('⏳ Time is Up!', `Nobody guessed it! The answer was: **${config.minigameAnswer}**`, '#FF0000')] });
        }
      });
    }

    // 10. AI Assistant
    const isAiChannel = message.channel.id === config.aiChannelId;
    if (isAiChannel || message.mentions.has(client.user)) {
      await message.channel.sendTyping();
      try {
        const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
        const chat = ai.chats.create({
          model: 'gemini-3.5-flash-lite',
          config: { systemInstruction: aiSystemInstruction }
        });
        const result = await chat.sendMessage({ message: prompt || 'Hello!' });
        return message.reply({ embeds: [makeEmbed('🤖 AI Assistant', result.text, '#A8FF78')] });
      } catch (err) {
        return message.reply({ embeds: [makeEmbed('⚠️ Error', 'AI module is currently unavailable.', '#FF0000')] });
      }
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

// 5. Custom Per-Server Trackers (YouTube, Twitter, TikTok)
async function checkSocialMedia(client, parser) {
  const configs = await GuildConfig.find();
  
  for (const config of configs) {
    // YouTube
    if (config.ytTrackId && config.ytChannelId) {
      try {
        const ytUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.ytTrackId}`;
        const feed = await parser.parseURL(ytUrl);
        if (feed.items.length > 0 && feed.items[0].id !== config.lastYtVideoId) {
          config.lastYtVideoId = feed.items[0].id;
          await config.save();
          const channel = client.channels.cache.get(config.ytChannelId);
          if (channel) channel.send({ embeds: [makeEmbed('🎥 New YouTube Video!', `**${feed.items[0].title}**\n${feed.items[0].link}`, '#FF0000')] });
        }
      } catch(e) {}
    }

    // Twitter (via RSSHub or OpenRSS)
    if (config.twitterTrackId && config.twitterChannelId) {
      try {
        const twUrl = `https://openrss.org/x.com/${config.twitterTrackId}`;
        const feed = await parser.parseURL(twUrl);
        if (feed.items.length > 0 && feed.items[0].guid !== config.lastTweetId) {
          config.lastTweetId = feed.items[0].guid;
          await config.save();
          const channel = client.channels.cache.get(config.twitterChannelId);
          if (channel) channel.send({ embeds: [makeEmbed('🐦 New Tweet!', `**New post from ${config.twitterTrackId}**\n${feed.items[0].link}`, '#1DA1F2')] });
        }
      } catch(e) {}
    }
    
    // TikTok (via RSSHub)
    if (config.tiktokTrackId && config.tiktokChannelId) {
      try {
        const tkUrl = `https://rsshub.app/tiktok/user/${config.tiktokTrackId}`;
        const feed = await parser.parseURL(tkUrl);
        if (feed.items.length > 0 && feed.items[0].guid !== config.lastTikTokId) {
          config.lastTikTokId = feed.items[0].guid;
          await config.save();
          const channel = client.channels.cache.get(config.tiktokChannelId);
          if (channel) channel.send({ embeds: [makeEmbed('📱 New TikTok!', `**New post from ${config.tiktokTrackId}**\n${feed.items[0].link}`, '#000000')] });
        }
      } catch(e) {}
    }
  }
}
