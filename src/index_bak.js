require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');      
const { startScheduler, sendCodingQuestion, sendInterviewQuestion, buildCodingPayload, buildInterviewPayload } = require('./scheduler');
const { getInterviewQuestion } = require('./questions/interview');
const { getGeminiBattleQuestions, getGeminiCheatsheet, analyzeResumeForInterview, reviewUserCode } = require('./questions/gemini');
const { connectDB } = require('./database');
const stringSimilarity = require('string-similarity');
const User = require('./models/User');
const Doubt = require('./models/Doubt');

// Level / Badges System
const ROLES = {
    BEGINNER: { name: 'Beginner', threshold: 10 },
    CORE_MASTER: { name: 'Core Master', threshold: 50 },
    INTERVIEW_READY: { name: 'Interview Ready', threshold: 100 }
};

async function checkAndAssignRoles(member, userDoc) {
    if (!member || !member.guild) return;

    const m = userDoc.mastery || {};
    const totalXP = (m.DSA || 0) + (m.OS || 0) + (m.DBMS || 0) + (m.WebDev || 0) + (m.CP || 0) + (m.General || 0);

    let targetRoleName = null;
    if (totalXP >= ROLES.INTERVIEW_READY.threshold) targetRoleName = ROLES.INTERVIEW_READY.name;
    else if (totalXP >= ROLES.CORE_MASTER.threshold) targetRoleName = ROLES.CORE_MASTER.name;
    else if (totalXP >= ROLES.BEGINNER.threshold) targetRoleName = ROLES.BEGINNER.name;

    if (!targetRoleName) return;

    try {
        const guild = member.guild;
        let role = guild.roles.cache.find(r => r.name === targetRoleName);
        if (!role) {
            role = await guild.roles.create({
                name: targetRoleName,
                color: targetRoleName === 'Interview Ready' ? 0xFFD700 : (targetRoleName === 'Core Master' ? 0xE67E22 : 0x2ECC71),
                reason: 'Auto-created for level progression system'
            });
        }

        if (!member.roles.cache.has(role.id)) {
            const roleNamesToRemove = Object.values(ROLES).map(r => r.name).filter(n => n !== targetRoleName);
            for (const name of roleNamesToRemove) {
                const oldRole = guild.roles.cache.find(r => r.name === name);
                if (oldRole && member.roles.cache.has(oldRole.id)) {
                    await member.roles.remove(oldRole).catch(() => {});
                }
            }
            await member.roles.add(role).catch(() => {});
        }
    } catch (err) {
        console.error("Failed to assign roles:", err);
    }
}


// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Bot ready
client.on('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  
  // Connect to the database when the bot starts
  await connectDB();

  startScheduler(client);
});
  // Daily Battle Limit state
  let dailyBattleCount = 0;
  let lastBattleDate = new Date().toDateString();
// Message commands (No ! prefix, natural text)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase().trim();

  // Register the current channel for automated daily questions
  if (content === 'setchannel') {
    process.env.CHANNEL_ID = message.channel.id;
    await message.reply(
      `✅ **This channel (${message.channel.name}) has been set for automated questions!**\n` +
      `\n` +
      `**What this means:**\n` +
      `The bot will automatically send a combo of one Coding Challenge and one Interview Question to this specific channel three times a day:\n` +
      `⏰ **8:00 AM IST**\n` +
      `⏰ **2:00 PM IST**\n` +
      `⏰ **8:00 PM IST**\n` +
      `\n` +
      `*(Note for the Developer: To make this system-wide and permanent across reboots, be sure to manually paste \`CHANNEL_ID=${message.channel.id}\` into your \`.env\` file in VS Code!)*`
    );
    return;
  }

  // Manual trigger for testing
  if (content === 'coding') {
    await sendCodingQuestion(client);
  }

  if (content === 'interview') {
    await sendInterviewQuestion(client);
  }

  // --- DOUBT NOTEBOOK SYSTEM ---
  if (content.startsWith('ask doubt')) {
    const doubtChannelId = process.env.DOUBT_CHANNEL_ID;
    if (message.channel.id !== doubtChannelId) {
        return message.reply(`⚠️ Please ask your doubts directly inside the <#${doubtChannelId}> channel!`);
    }

    const questionMessage = message.content.slice('ask doubt'.length).trim();
    if (!questionMessage) return message.reply("Please specify your doubt. Example: `ask doubt What is a closure in JavaScript?`");

    const newDoubt = new Doubt({
        askerId: message.author.id,
        askerName: message.author.username,
        question: questionMessage
    });
    await newDoubt.save();

    const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`🤔 New Doubt from ${message.author.username}`)
        .setDescription(questionMessage)
        .setFooter({ text: `Doubt ID: ${newDoubt._id} | Use 'doubts' to see all open doubts`})
        .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Frontend Dev')
                .setStyle(ButtonStyle.Link)
                .setURL('https://roadmap.sh/frontend'),
            new ButtonBuilder()
                .setLabel('Backend Dev')
                .setStyle(ButtonStyle.Link)
                .setURL('https://roadmap.sh/backend'),
            new ButtonBuilder()
                .setLabel('DSA & Patterns')
                .setStyle(ButtonStyle.Link)
                .setURL('https://roadmap.sh/datastructures-and-algorithms')
        );
        return message.reply({ embeds: [embed], components: [row] });
    }

    if (content === 'hello' || content === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🤖 Welcome to the Placement Prep Bot!')
      .setDescription('I am here to help you grind algorithms, master core CS subjects, and prep for top company interviews! Here is what I can do for you:')
      .addFields(
        { name: '🔥 Core Commands', value: 
          `\`coding\` - Get a random competitive programming or DSA challenge.\n` +
          `\`interview\` - Test your knowledge with a Core CS concept or trivia question.\n` +
          `\`battle\` - Start a real-time Battle Mode trivia competition! First to answer wins.\n` +
          `\`stats\` - View your RPG-style Mastery Tracker progress bars.` 
        },
        { name: '📖 Doubt Notebook', value:
          `\`ask doubt <your question>\` - Post a doubt which will be created as a thread in the Doubts channel.\n` +
          `\`doubts\` - View a list of recent unanswered doubts in the server.`
        },
        { name: '📈 How to Level Up', value: 'Whenever you see a question, click the green **"I knew this! (+1 XP)"** button to log your progress in the database. I will track your mastery in DSA, OS, DBMS, WebDev, and CP!' },
        { name: '⚙️ Admin', value: '`setchannel` - Locks the daily automated questions to the current channel (runs at 8am, 2pm, and 8pm IST).' }
      )
      .setFooter({ text: 'Created to help you crack the interview. Let\'s get grinding! 🚀' });

    await message.reply({ embeds: [embed] });
  }
});

// Button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId === 'next_coding') {
      await interaction.deferUpdate();
      const payload = await buildCodingPayload();
      if (payload) await interaction.message.channel.send({ ...payload, content: `<@${interaction.user.id}> requested another question!` });
    }
    
    if (interaction.customId === 'next_interview') {
      await interaction.deferUpdate();
      const payload = await buildInterviewPayload();
      if (payload) await interaction.message.channel.send({ ...payload, content: `<@${interaction.user.id}> requested another question!` });
    }

    if (interaction.customId.startsWith('learned_')) {
      const topic = interaction.customId.split('_')[1]; // e.g. DSA, OS, WebDev
      await interaction.deferReply({ ephemeral: true });

      // Upsert User in MongoDB
      let user = await User.findOne({ discordId: interaction.user.id });
      if (!user) {
          user = new User({ discordId: interaction.user.id, username: interaction.user.username });
      }

      // Increment specific topic mastery
      if (user.mastery[topic] !== undefined) {
          user.mastery[topic] += 1;
      } else {
          user.mastery.General += 1;
      }
      await user.save();
        try { await checkAndAssignRoles(interaction.member, user); } catch (e) {}

      await interaction.editReply(`✅ Good job! You just gained +1 XP in **${topic}**. Type \`stats\` to see your progress.`);
    }

    if (interaction.customId.startsWith('resolve_')) {
      const doubtId = interaction.customId.split('_')[1];
      const doubt = await Doubt.findById(doubtId);
      
      if (!doubt) {
        return interaction.reply({ content: "Doubt not found in the database.", ephemeral: true });
      }
      
      if (doubt.askerId !== interaction.user.id) {
          return interaction.reply({ content: "Only the original asker can mark this as resolved!", ephemeral: true });
      }
      
      doubt.status = 'Resolved';
      await doubt.save();
      
      // Update message embed
      const currentEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(currentEmbed)
          .setColor(0x57F287)
          .setTitle(`✅ Resolved Doubt from ${doubt.askerName}`);
          
      // Remove buttons
      await interaction.update({ embeds: [updatedEmbed], components: [] });
      await interaction.channel.send(`✅ This doubt has been marked as resolved by <@${interaction.user.id}>!`);
    }

      // Roadmap Buttons
      if (interaction.customId.startsWith('rm_')) {
          const path = interaction.customId.split('_')[1];
          let roadmaps;
          try {
              roadmaps = require('./data/roadmaps.json');
          } catch(e) {
              return interaction.reply({ content: "Could not load roadmaps.", ephemeral: true });
          }

          if (roadmaps[path]) {
              const embed = new EmbedBuilder()
                  .setColor(roadmaps[path].color)
                  .setTitle(roadmaps[path].title)
                  .setDescription(roadmaps[path].description)
                  .setFooter({ text: 'Internship Roadmap Mode' });
              return interaction.reply({ embeds: [embed], ephemeral: true });
          }
      }

    } catch (err) {
      console.error('Error handling button interaction:', err);
    }
});

// Login
client.login(process.env.TOKEN);