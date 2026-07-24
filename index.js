require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionFlagsBits 
} = require('discord.js');
const OpenAI = require('openai');
const Parser = require('rss-parser');

// Inisialisasi Client Discord
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

// Inisialisasi OpenAI & RSS Parser
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const parser = new Parser();

// --- KONFIGURASI BOT ---
const CONFIG = {
  PREFIX: '!',
  AI_CHANNEL_ID: '1518961912795234344',        // ID channel khusus tanya Jawab AI
  NOTIF_CHANNEL_ID: '1518961912795234344',    // ID channel notifikasi YouTube
  ANNOUNCE_CHANNEL_ID: '1518961912795234344',// ID channel pengumuman
  YT_CHANNEL_ID: 'UCLXgvJ590t3-FOVXxpRD0bw',                  // ID Channel YouTube (Contoh: UCxxx)
  BAD_WORDS: ['nigga', 'fuck', 'anjing'],  // Kata-kata terlarang (AutoMod)
  REACT_ROLE: {
    MESSAGE_ID: 'ID_PESAN_REACT_ROLE',        // ID Pesan tempat react
    EMOJI: '🎮',                              // Emoji yang digunakan
    ROLE_ID: 'ID_ROLE_YANG_DIBERIKAN'          // ID Role yang akan didapatkan
  }
};

let lastYtVideoId = '';

client.once('ready', () => {
  console.log(`Bot onlinei: ${client.user.tag}`);
  
  // Cek notifikasi YouTube setiap 5 menit
  checkYouTubeUpdates();
  setInterval(checkYouTubeUpdates, 5 * 60 * 1000);
});

// ==========================================
// 1. AUTO RESPOND, AUTO MOD, & CHATGPT
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // --- FITUR: AUTO MODERATION ---
  const hasBadWord = CONFIG.BAD_WORDS.some(word => 
    message.content.toLowerCase().includes(word)
  );
  if (hasBadWord) {
    await message.delete().catch(() => {});
    const warnMsg = await message.channel.send(`${message.author}, Your message has been deleted!`);
    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
    return;
  }

  // --- FITUR: CHATGPT (Sebut Bot atau di Channel Khusus) ---
  const isMentioned = message.mentions.has(client.user);
  const isAiChannel = message.channel.id === CONFIG.AI_CHANNEL_ID;

  if (isMentioned || isAiChannel) {
    await message.channel.sendTyping();
    try {
      const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt || 'Halo!' }]
      });
      return message.reply(response.choices[0].message.content);
    } catch (err) {
      console.error(err);
      return message.reply('Something wrong, try again later. ChatGPT.');
    }
  }

  // --- FITUR: AUTO RESPOND SEDERHANA ---
  const text = message.content.toLowerCase();
  if (text === 'halo' || text === 'hai') {
    return message.reply('Hello! How can i help you? 👋');
  }
  if (text === 'ping') {
    return message.reply(`Pong! 🏓 (${client.ws.ping}ms)`);
  }

  // --- FITUR: ANNOUNCEMENT COMMAND (!announce #channel Pesan) ---
  if (text.startsWith(`${CONFIG.PREFIX}announce`)) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('you not have permission to use this command!');
    }

    const args = message.content.split(' ').slice(1);
    const targetChannel = message.mentions.channels.first();
    const announceText = args.slice(1).join(' ');

    if (!targetChannel || !announceText) {
      return message.reply('Format invalid! use: `!announce (#channel) (Message)`');
    }

    const embed = new EmbedBuilder()
      .setTitle('📢 ANNOUNCEMENT')
      .setDescription(announceText)
      .setColor('#FF0000')
      .setFooter({ text: `By: ${message.author.username}` })
      .setTimestamp();

    await targetChannel.send({ embeds: [embed] });
    return message.reply(`Target${targetChannel}!`);
  }
});

// ==========================================
// 2. REACTION ROLE (TAMBAH & HAPUS ROLE)
// ==========================================
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  if (
    reaction.message.id === CONFIG.REACT_ROLE.MESSAGE_ID &&
    reaction.emoji.name === CONFIG.REACT_ROLE.EMOJI
  ) {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.get(CONFIG.REACT_ROLE.ROLE_ID);
    
    if (role) await member.roles.add(role);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  if (
    reaction.message.id === CONFIG.REACT_ROLE.MESSAGE_ID &&
    reaction.emoji.name === CONFIG.REACT_ROLE.EMOJI
  ) {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.get(CONFIG.REACT_ROLE.ROLE_ID);
    
    if (role) await member.roles.remove(role);
  }
});

// ==========================================
// 3. NOTIFIKASI YOUTUBE AUTOMATIS (RSS)
// ==========================================
async function checkYouTubeUpdates() {
  if (!CONFIG.YT_CHANNEL_ID || CONFIG.YT_CHANNEL_ID.startsWith('UCxxxx')) return;
  try {
    const feed = await parser.parseURL(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CONFIG.YT_CHANNEL_ID}`
    );
    if (feed.items.length > 0) {
      const latestVideo = feed.items[0];
      if (latestVideo.id !== lastYtVideoId) {
        lastYtVideoId = latestVideo.id;

        const channel = client.channels.cache.get(CONFIG.NOTIF_CHANNEL_ID);
        if (channel) {
          channel.send(
            `**New Video!**\n**${latestVideo.title}**\nLink: ${latestVideo.link}`
          );
        }
      }
    }
  } catch (err) {
    console.error('Something wrong with YouTube:', err.message);
  }
}

client.login(process.env.DISCORD_TOKEN);
