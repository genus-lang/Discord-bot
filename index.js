require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');      
const { startScheduler, sendCodingQuestion, sendInterviewQuestion, buildCodingPayload, buildInterviewPayload } = require('./scheduler');
const { getInterviewQuestion } = require('./questions/interview');
const { getGeminiBattleQuestions } = require('./questions/gemini');
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
            .setCustomId(`resolve_${newDoubt._id}`)
            .setLabel('Mark Resolved (Author Only)')
            .setStyle(ButtonStyle.Success)
    );

    // Send it directly to the current (restricted) channel where they typed the command
    const doubtMsg = await message.channel.send({ embeds: [embed], components: [row] });
    newDoubt.messageId = doubtMsg.id;
    await newDoubt.save();

    try {
        // Delete the original message to keep the channel clean
        await message.delete();
    } catch(e) { }

    try {
        await doubtMsg.startThread({
            name: `Reply here to answer ${message.author.username}`,
            autoArchiveDuration: 1440,
            reason: 'Discussion for doubt'
        });
    } catch(e) { 
        console.error("Could not start thread", e.message); 
    }
  }

  if (content === 'doubts') {
    const doubtChannelId = process.env.DOUBT_CHANNEL_ID;
    if (message.channel.id !== doubtChannelId) {
        return message.reply(`⚠️ Please view doubts in the <#${doubtChannelId}> channel!`);
    }

    const openDoubts = await Doubt.find({ status: 'Open' }).sort({ createdAt: -1 }).limit(10);
    
    if (openDoubts.length === 0) {
        return message.reply("🎉 There are no open doubts right now! Everyone is so smart.");
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("📖 Open Doubts Notebook")
        .setDescription("Here are the latest active doubts. Jump into the doubts channel to help out!");
        
    openDoubts.forEach((d) => {
        embed.addFields({ 
            name: `Doubt by ${d.askerName} (${d.createdAt.toLocaleDateString()})`, 
            value: `${d.question.substring(0, 100)}${d.question.length > 100 ? '...' : ''}\n*Resolved?: ${d.status === 'Open' ? '❌' : '✅'}*`
        });
    });
    
    await message.reply({ embeds: [embed] });
  }

  if (content === 'stats') {
    let user = await User.findOne({ discordId: message.author.id });
    if (!user) {
        return message.reply("You haven't answered any questions yet. Start practicing to build your stats!");
    }

    const m = user.mastery;
    // Helper to generate a progress bar max 20 pts
    const makeBar = (score, max = 20) => {
        let sc = Math.min(score, max);
        let filled = Math.floor((sc / max) * 10);
        let empty = 10 - filled;
        let percent = Math.floor((sc / max) * 100);
        return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}% (${score} XP)`;
    };

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`📊 Topic Mastery: ${message.author.username}`)
        .addFields(
            { name: '🌳 DSA', value: `\`${makeBar(m.DSA)}\``, inline: false },
            { name: '💻 Web Dev', value: `\`${makeBar(m.WebDev)}\``, inline: false },
            { name: '💾 OS', value: `\`${makeBar(m.OS)}\``, inline: false },
            { name: '🗄️ DBMS', value: `\`${makeBar(m.DBMS)}\``, inline: false },
            { name: '🏎️ Competitive', value: `\`${makeBar(m.CP)}\``, inline: false },
            { name: '🌐 General / Other', value: `\`${makeBar(m.General)}\``, inline: false },
            { name: '⚔️ Battle Wins', value: `\`🏆 ${user.battleWins || 0} Wins\``, inline: false }
        )
        .setFooter({ text: 'Keep using "I knew this!" buttons to level up.' });

    await message.reply({ embeds: [embed] });
  }

  if (content === 'battle') {
    const battleChannelId = process.env.BATTLE_MODE_ID;
    if (message.channel.id !== battleChannelId) {
        return message.reply(`⚠️ Battle mode can only be started in the <#${battleChannelId}> channel!`);
    }

    const currentDate = new Date().toDateString();
    if (currentDate !== lastBattleDate) {
        // Reset the tracker on a new day
        dailyBattleCount = 0;
        lastBattleDate = currentDate;
    }

    if (dailyBattleCount >= 5) {
        return message.channel.send("⚠️ **Free battle mode limit over!** As it's first come first battle, the limit will be removed tomorrow.");
    }

    // Increment successfully started battle counter
    dailyBattleCount++;

    try { await message.delete(); } catch(e) {}

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('join_battle')
            .setLabel('Join Battle')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('start_battle')
            .setLabel('Start Now')
            .setStyle(ButtonStyle.Primary)
    );

    const lobbyEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⚔️ BATTLE LOBBY')
        .setDescription('A **20-question** trivia battle is starting!\n\nClick **Join Battle** to participate.\n*Need at least 2 players to begin.*\n\nLobby closes in 30 seconds...');

    const lobbyMsg = await message.channel.send({ embeds: [lobbyEmbed], components: [row] });
    
    // Store players participating: discordId -> username
    const players = new Map();
    players.set(message.author.id, message.author.username); // Creator auto joins
    
    const lobbyCollector = lobbyMsg.createMessageComponentCollector({ time: 30000 });

    const battleLoop = async () => {
        if (players.size < 2) {
            return message.channel.send("❌ Not enough players joined. Minimum 2 players required. Battle cancelled.");
        }
        
        await message.channel.send(`🚀 **Battle starting with ${players.size} players!** 20 questions, first to answer gets a point. Let's go! (Wait 3 seconds for the first question...)`);
        
        // Track scores
        const scores = {};
        players.forEach((name, id) => scores[id] = 0);
        
        const TOTAL_QUESTIONS = 20;

        for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
            await new Promise(r => setTimeout(r, 3000)); // 3 sec pause between questions
            
            const q = await getInterviewQuestion();
            if (!q) {
                await message.channel.send("Failed to fetch a question, skipping...");
                continue;
            }

            const qEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`⚔️ BATTLE: Question ${i} / ${TOTAL_QUESTIONS}`)
                .setDescription(`**${q.question}**\n\nType your answer in the chat! You have **20 seconds**.`)
                .addFields({ name: 'Category', value: q.category, inline: true })
                .setFooter({ text: 'Quick, time is ticking!' });

            await message.channel.send({ embeds: [qEmbed] });

            const filter = m => players.has(m.author.id) && !m.author.bot;
            
            await new Promise((resolve) => {
                const qCollector = message.channel.createMessageCollector({ filter, time: 20000 });
                let questionWinner = null;

                qCollector.on('collect', async m => {
                    let isCorrect = false;
                    const userA = m.content.toLowerCase().trim();
                    const correctA = q.exactAnswer ? q.exactAnswer.toLowerCase().trim() : null;

                    if (correctA) {
                        if (userA === correctA) {
                            isCorrect = true;
                        } else if (q.optionsList && q.optionsList.length > 0) {
                            const idx = q.optionsList.findIndex(opt => opt.toLowerCase().trim() === correctA);
                            if (idx !== -1 && userA === (idx + 1).toString()) {
                                isCorrect = true;
                            }
                        }

                        if (!isCorrect && stringSimilarity.compareTwoStrings(userA, correctA) > 0.8) {
                            isCorrect = true;
                        }

                        if (isCorrect) {
                            questionWinner = m;
                            qCollector.stop('winner');
                        }
                    }
                });

                qCollector.on('end', async (collected, reason) => {
                    if (reason === 'winner' && questionWinner) {
                        const winnerId = questionWinner.author.id;
                        scores[winnerId] += 1;
                        await message.channel.send(`✅ **${questionWinner.author.username}** got it! (+1 pt)\nCorrect answer was: **${q.exactAnswer}**`);
                    } else {
                        await message.channel.send(`⏰ Time's up! Nobody got it.\nCorrect answer was: **${q.exactAnswer || "Unknown"}**`);
                    }
                    resolve();
                });
            });
        }

        // Leaderboard logic
        const sortedPlayers = Object.entries(scores).sort((a,b) => b[1] - a[1]);
        const winnerId = sortedPlayers[0][0];
        const winnerScore = sortedPlayers[0][1];
        
        let leaderboardText = "";
        sortedPlayers.forEach(([id, score], idx) => {
            let medal = idx === 0 ? "🏆" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : "🔸"));
            leaderboardText += `${medal} **${players.get(id)}**: ${score} pts\n`;
        });

        const finalEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("🏁 BATTLE OVER! 🏁")
            .setDescription(`Here are the final scores for this 20-question battle:\n\n${leaderboardText}`);

        if (winnerScore > 0) {
            // Update db for the winner
            let user = await User.findOne({ discordId: winnerId });
            if (!user) {
                user = new User({ discordId: winnerId, username: players.get(winnerId) });
            }
            user.battleWins = (user.battleWins || 0) + 1;
            user.mastery.General += 15; // Give 15 XP for winning a 20 question match
            await user.save();
            try { const guildMember = await message.guild.members.fetch(winnerId); await checkAndAssignRoles(guildMember, user); } catch(e) {}
            finalEmbed.addFields({ name: 'Rewards', value: `**${players.get(winnerId)}** receives +15 General XP and +1 Battle Win!` });
        } else {
            finalEmbed.addFields({ name: 'Rewards', value: "Nobody scored any points! No rewards given." });
        }

        await message.channel.send({ embeds: [finalEmbed] });
    };

    lobbyCollector.on('collect', async (i) => {
        if (i.customId === 'join_battle') {
            if (!players.has(i.user.id)) {
                players.set(i.user.id, i.user.username);
                await i.reply({ content: `✅ ${i.user.username} joined! Total players: ${players.size}`, ephemeral: false });
            } else {
                await i.reply({ content: `You are already in the lobby!`, ephemeral: true });
            }
        } else if (i.customId === 'start_battle') {
            if (i.user.id === message.author.id) {
                lobbyCollector.stop('forced');
            } else {
                await i.reply({ content: `Only ${message.author.username} can force start early.`, ephemeral: true });
            }
        }
    });

    lobbyCollector.on('end', async () => {
        try { await lobbyMsg.edit({ components: [] }); } catch(e) {}
        await battleLoop();
    });

    return;
  }

  
    // 6. Formula & Cheat-Sheet Mode
    if (content.startsWith('cheatsheet')) {
        const generalChannelId = process.env.GENERAL_CHANNEL_ID;
        if (message.channel.id !== generalChannelId) {
            return message.reply(`⚠️ This command can only be used in the <#${generalChannelId}> channel!`);
        }

        const args = content.split(' ');
        if (args.length < 2) {
            return message.reply(`\n**Available Cheat Sheets:**\n\`os\` - Operating Systems\n\`dsa\` - Data Structures & Algorithms\n\`dbms\` - Database Management\n\`cp\` - Competitive Programming\n\n*Usage: \`cheatsheet os\`*`);
        }
        
        const topic = args[1].toLowerCase();
        let cheatsheets;
        try {
            cheatsheets = require('./data/cheatsheets.json');
        } catch (e) {
            return message.reply("Could not load knowledge bank.");
        }

        if (cheatsheets[topic]) {
            const embed = new EmbedBuilder()
                .setColor(cheatsheets[topic].color)
                .setTitle(cheatsheets[topic].title)
                .setDescription(cheatsheets[topic].description)
                .setFooter({ text: 'Cheat-Sheet & Knowledge Bank Mode' });
            return message.reply({ embeds: [embed] });
        } else {
            return message.reply("Cheat sheet not found. Try \`cheatsheet\` to see available topics.");
        }
    }

    // 7. Internship Roadmap Mode
    if (content === 'roadmap') {
        const generalChannelId = process.env.GENERAL_CHANNEL_ID;
        if (message.channel.id !== generalChannelId) {
            return message.reply(`⚠️ This command can only be used in the <#${generalChannelId}> channel!`);
        }

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('??? Internship Roadmap Selection')
            .setDescription('Select the path you want a step-by-step guide for:')
            .setFooter({ text: 'Internship Roadmap Mode' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rm_frontend')
                .setLabel('Frontend Dev')
                .setEmoji('??')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('rm_backend')
                .setLabel('Backend Dev')
                .setEmoji('??')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('rm_dsa')
                .setLabel('DSA & Patterns')
                .setEmoji('??')
                .setStyle(ButtonStyle.Danger)
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