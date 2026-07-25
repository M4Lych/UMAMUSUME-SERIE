require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionFlagsBits 
} = require('discord.js');
const Parser = require('rss-parser');
const { GoogleGenAI } = require('@google/genai');
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

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
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- KONFIGURASI BOT ---
const CONFIG = {
  PREFIX: '!',
  AI_CHANNEL_ID: '1518957044848398457',        // ID channel khusus tanya Jawab AI
  NOTIF_CHANNEL_ID: '1523620764908261416',    // ID channel notifikasi YouTube
  ANNOUNCE_CHANNEL_ID: '1518961912795234344',// ID channel pengumuman
  YT_CHANNEL_ID: 'UCLXgvJ590t3-FOVXxpRD0bw',                  // ID Channel YouTube (Contoh: UCxxx)
  BAD_WORDS: ['nigga', 'fuck', 'anjing'],  // Kata-kata terlarang (AutoMod)
  TWITTER_RSS_URL: 'https://openrss.org/x.com/@umamusume_eng', 
  YT_CHANNEL_DISCORD_ID: '1518951187796463759',    // Channel khusus notif YouTube
  TWITTER_CHANNEL_ID: '1523620764908261416',   
  REACT_ROLE: {
    MESSAGE_ID: 'ID_PESAN_REACT_ROLE',        // ID Pesan tempat react
    EMOJI: '🎮',                              // Emoji yang digunakan
    ROLE_ID: 'ID_ROLE_YANG_DIBERIKAN'          // ID Role yang akan didapatkan
  }
};

let lastYtVideoId = '';
let lastTweetId = '';

client.once('ready', () => {
  console.log(`Bot online: ${client.user.tag}`);

  // Jalankan pengecekan YouTube & Twitter
  checkYouTubeUpdates();
  checkTwitterUpdates();

  setInterval(() => {
    checkYouTubeUpdates();
    checkTwitterUpdates();
  }, 5 * 60 * 1000); // Cek setiap 5 menit
});

// ==========================================
// 1. AUTO RESPOND, AUTO MOD, & CHATGPT
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // --- 1. FITUR: AUTO MODERATION ---
  const hasBadWord = CONFIG.BAD_WORDS.some(word => 
    message.content.toLowerCase().includes(word)
  );
  if (hasBadWord) {
    await message.delete().catch(() => {});
    const warnMsg = await message.channel.send(`${message.author}, Your message has been deleted!`);
    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
    return;
  }

  const text = message.content.toLowerCase();

  // --- 2. FITUR: ANNOUNCEMENT COMMAND ---
  if (text.startsWith(`${CONFIG.PREFIX}announce`)) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('You do not have permission to use this command!');
    }

    const args = message.content.slice(CONFIG.PREFIX.length + 8).trim();
    
    // Ambil channel dari tag biru (#) ATAU dari ID angka
    const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(args.split(' ')[0]);
    
    // Ambil teks sisa untuk pengumuman (menghapus tag channel dari teks)
    let announceText = args.replace(/<#\d+>/, '').trim();
    // Jika menggunakan ID angka, hapus ID tersebut dari teks
    if (targetChannel && announceText.startsWith(targetChannel.id)) {
      announceText = announceText.replace(targetChannel.id, '').trim();
    }

    // Cek apakah ada file/gambar yang diunggah bersama pesan ini
    const attachment = message.attachments.first();

    // Validasi: Harus ada channel, dan harus ada teks ATAU gambar
    if (!targetChannel || (!announceText && !attachment)) {
      return message.reply('Format invalid! Use: `!announce #channel Pesan kamu` (Bisa sambil upload gambar juga!)');
    }

    // Buat Embed dasar
    const embed = new EmbedBuilder()
      .setTitle('📢 ANNOUNCEMENT')
      .setColor('#FF0000')
      .setFooter({ text: `By: ${message.author.username}` })
      .setTimestamp();

    // Jika ada teks pengumuman, masukkan ke deskripsi
    if (announceText.length > 0) {
      embed.setDescription(announceText);
    }

    // Jika ada lampiran dan itu adalah gambar, masukkan ke dalam embed
    if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
      embed.setImage(attachment.url);
    }

    // Kirim Embed ke channel tujuan
    await targetChannel.send({ embeds: [embed] });
    return message.reply(`✅ Announcement successfully sent to ${targetChannel}!`);
  }

  // --- 3. FITUR: AUTO RESPOND SEDERHANA ---
  if (text === 'halo' || text === 'hai') {
    return message.reply('Hello! How can i help you? 👋');
  }
  if (text === 'ping') {
    return message.reply(`Pong! 🏓 (${client.ws.ping}ms)`);
  }

  // --- 4. FITUR: GEMINI AI ---
  const isMentioned = message.mentions.has(client.user);
  const isAiChannel = message.channel.id === CONFIG.AI_CHANNEL_ID;

  if (isMentioned || isAiChannel) {
    await message.channel.sendTyping();
    try {
      const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();
      
      const messages = await message.channel.messages.fetch({ limit: 10 });
      
      // PERBAIKAN: Filter pesan kosong dan abaikan pesan saat ini dari history
      const chatHistory = messages
        .filter(msg => msg.content && msg.content.trim().length > 0) // Abaikan pesan kosong/gambar
        .filter(msg => msg.id !== message.id) // WAJIB: Buang pesan yang memicu command ini dari history
        .reverse()
        .map(msg => ({
          role: msg.author.id === client.user.id ? 'model' : 'user',
          parts: [{ text: msg.content.replace(`<@${client.user.id}>`, '').trim() }]
        }));

      const chat = ai.chats.create({
        model: 'gemini-3.5-flash-lite',
        history: chatHistory
      });

      const result = await chat.sendMessage({ message: prompt || 'Halo!' });
      return message.reply(result.text);

    } catch (err) {
      // Gunakan console.log ini untuk memantau jika ada error lain di Termux
      console.log('--- ERROR GEMINI ---');
      console.log(err); 
      return message.reply('Sistem AI sedang mengalami gangguan. Cek console Termux.');
    }
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

        const channel = client.channels.cache.get(CONFIG.YT_CHANNEL_DISCORD_ID);
		if (channel) {
		 channel.send(`**New Video!**\n**${latestVideo.title}**\nLink: ${latestVideo.link}`);
		}
      }
    }
  } catch (err) {
    console.error('Something wrong with YouTube:', err.message);
  }
}

async function checkTwitterUpdates() {
  if (!CONFIG.TWITTER_RSS_URL) return;
  try {
    const feed = await parser.parseURL(CONFIG.TWITTER_RSS_URL);
    if (feed.items.length > 0) {
      const latestTweet = feed.items[0];
      const tweetId = latestTweet.guid || latestTweet.id;

      if (tweetId !== lastTweetId) {
        lastTweetId = tweetId;

        const channel = client.channels.cache.get(CONFIG.TWITTER_CHANNEL_ID);
if (channel) {
  const tweetEmbed = new EmbedBuilder()
    .setColor('#1DA1F2')
    .setTitle('New Tweet!')
    .setURL(latestTweet.link)
    .setDescription(latestTweet.content || latestTweet.title || 'No content')
    .setTimestamp();

  await channel.send({ embeds: [tweetEmbed] });
}
      }
    }
  } catch (err) {
    console.error('Something wrong with X:', err.message);
  }
}


client.login(process.env.DISCORD_TOKEN);

