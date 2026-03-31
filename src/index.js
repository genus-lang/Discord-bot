require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');      
const { startScheduler, sendCodingQuestion, sendInterviewQuestion, buildCodingPayload, buildInterviewPayload } = require('./scheduler');
const { getInterviewQuestion } = require('./questions/interview');
const { getGeminiBattleQuestions, getGeminiCheatsheet, analyzeResumeForInterview, reviewUserCode } = require('./questions/gemini');
const { connectDB } = require('./database');
const { startContestTracker } = require('./contests');
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Bot ready
client.on('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  
  // Connect to the database when the bot starts
  await connectDB();

  startScheduler(client);
  startContestTracker(client);
});

// Welcome new users with features & commands
client.on('guildMemberAdd', async (member) => {
  try {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle(`👋 Welcome to the Server, ${member.user.username}!`)
      .setDescription('We are excited to have you here! Our bot provides many interactive tools to help you prepare for interviews and upskill. Here is a guide on where and how to use them:')
      .addFields(
        { name: '🔥 Coding & Interview (Any Channel)', value: `• \`coding\` : Get a coding / DSA challenge\n• \`interview\` : Get a core CS conceptual question\n• \`stats\` : See your RPG-style mastery progression` },
        { name: '💻 General Channel (<#' + process.env.GENERAL_CHANNEL_ID + '>)', value: `• \`resume <your resume text>\` : Get custom interview questions based on your resume\n• \`review <paste code>\` : Have a Senior AI Engineer review your codebase for bugs & optimization` },
        { name: '🗺️ Roadmap Channel (<#' + process.env.ROADMAP_CHANNEL_ID + '>)', value: `• \`roadmap\` : Select a role (Frontend/Backend/DSA) for an interactive learning map\n• \`cheatsheet\` : Select a CS subject (OS, DBMS, SQL, etc.) from the menu to generate a study guide` },
        { name: '⚔️ Battle Mode (<#' + process.env.BATTLE_MODE_ID + '>)', value: `• \`battle\` : Start an intense live multiplayer CS trivia shootout!` },
        { name: '📚 Doubt Notebook (<#' + process.env.DOUBT_CHANNEL_ID + '>)', value: `• \`ask doubt <your question>\` : Post a question and auto-create a discussion thread\n• \`doubts\` : View open doubts that need answering` }
      )
      .setThumbnail(member.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'Start exploring and happy coding! 🚀' });

    await member.send({ embeds: [embed] }).catch(err => {
        const generalChannel = member.guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
        if (generalChannel) generalChannel.send({ content: `<@${member.user.id}>`, embeds: [embed] }).catch(() => {});
    });
  } catch (e) {
    console.error('Welcome failed', e);
  }
});






let dailyBattleCount = 0;
let lastBattleDate = new Date().toDateString();
let dailyReviewCount = 0;
let dailyResumeCount = 0;
let aiDate = new Date().toDateString();

const featureToggles = { coding: true, interview: true, stats: true, doubts: true, review: true, resume: true, cheatsheet: true, roadmap: true, battle: true };

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase().trim();

  // Admin commands:
  if (content === 'service') {
    const adminChannelId = process.env.ADMIN_CHANNEL_ID || '1488553134463914147';
    if (message.channel.id !== adminChannelId) return;

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle("⚙️ Admin Control Panel")
      .setDescription("Toggle the features of the bot ON/OFF instantly across all channels.");

    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    let i = 0;
    for (const [feature, isEnabled] of Object.entries(featureToggles)) {
        const btn = new ButtonBuilder()
          .setCustomId(`toggle_${feature}`)
          .setLabel(`${feature.toUpperCase()} [${isEnabled ? 'ON' : 'OFF'}]`)
          .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger);

        if (i < 5) row1.addComponents(btn);
        else row2.addComponents(btn);
        i++;
    }

    const components = row2.components.length > 0 ? [row1, row2] : [row1];
    return message.reply({ embeds: [embed], components });
  }

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
    if (!featureToggles.coding) return message.reply('⚠️ The admin has stopped or paused this service.');
    await sendCodingQuestion(client);
  }

  if (content === 'interview') {
    if (!featureToggles.interview) return message.reply('⚠️ The admin has stopped or paused this service.');
    await sendInterviewQuestion(client);
  }

  // --- STATS SYSTEM ---
  if (content === 'stats') {
    if (!featureToggles.stats) return message.reply('⚠️ The admin has stopped or paused this service.');
    let user = await User.findOne({ discordId: message.author.id });
    if (!user) {
        user = new User({ discordId: message.author.id, username: message.author.username });
        await user.save();
    }

    const m = user.mastery || {};
    const totalXP = (m.DSA || 0) + (m.OS || 0) + (m.DBMS || 0) + (m.WebDev || 0) + (m.CP || 0) + (m.General || 0);

    let rank = "Unranked";
    if (totalXP >= 100) rank = "🏆 Interview Ready";
    else if (totalXP >= 50) rank = "⭐ Core Master";
    else if (totalXP >= 10) rank = "🔰 Beginner";

    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle(`📊 Topic Mastery: ${message.author.username}`)
      .setThumbnail(message.author.displayAvatarURL())
      .setDescription(`Track your progress across CS Domains!\nGain XP by answering daily questions and clicking 'I knew this!'.\n\n**Current Rank:** ${rank}\n**Total XP:** ${totalXP}\n`)

    const maxBarLength = 10;
    const topics = ['DSA', 'OS', 'DBMS', 'WebDev', 'CP', 'General'];
    
    topics.forEach((topic) => {
        const xp = user.mastery[topic] || 0;
        const level = Math.floor(xp / 10) + 1;
        const currentXP = xp % 10;
        
        const filled = Math.round((currentXP / 10) * maxBarLength);
        const empty = maxBarLength - filled;
        
        // Progress bar using colored square emojis
        const progressBar = '🟩'.repeat(filled) + '⬛'.repeat(empty);
        
        embed.addFields({ name: `📘 ${topic} (Level ${level})`, value: `${progressBar}  **${currentXP}/10 XP**` });
    });

    embed.addFields({ name: '🏆 Battle Arena', value: `Total Wins: **${user.battleWins || 0}**` });

    return message.reply({ embeds: [embed] });
  }

  // --- DOUBT NOTEBOOK SYSTEM ---
  if (content === 'doubts') {
    if (!featureToggles.doubts) return message.reply('⚠️ The admin has stopped or paused this service.');
    const doubtChannelId = process.env.DOUBT_CHANNEL_ID;
    if (message.channel.id !== doubtChannelId) {
        return message.reply(`⚠️ Please use the doubts command directly inside the <#${doubtChannelId}> channel!`);
    }

    const openDoubts = await Doubt.find({ status: 'Open' }).sort({ createdAt: -1 }).limit(10);
    
    if (openDoubts.length === 0) {
      return message.reply("🎉 Yay! There are currently no open doubts in the server.");
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle("📚 Recently Asked Doubts")
      .setDescription("Help your peers by answering these open questions!")
      .setFooter({ text: "Use 'ask doubt' to post your own."});
      
    openDoubts.forEach((d, i) => {
      let qPreview = d.question.length > 100 ? d.question.substring(0, 97) + "..." : d.question;
      embed.addFields({ name: `#${i+1} From ${d.askerName} (ID: ${d._id})`, value: qPreview });
    });
    
    const rows = [];
    let currentRow = new ActionRowBuilder();
    openDoubts.forEach((d, i) => {
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`answer_${d._id}`)
          .setLabel(`Answer #${i+1}`)
          .setStyle(ButtonStyle.Primary)
      );
      if (currentRow.components.length === 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
    });
    if (currentRow.components.length > 0) {
      rows.push(currentRow);
    }

    return message.reply({ embeds: [embed], components: rows });
  }

  if (content.startsWith('ask doubt')) {
    if (!featureToggles.doubts) return message.reply('⚠️ The admin has stopped or paused this service.');
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
    
    
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`resolve_${newDoubt._id}`).setLabel('Mark Resolved (Author Only)').setStyle(ButtonStyle.Success)
    );
    const sentMsg = await message.reply({ embeds: [embed], components: [btnRow] });
    
    // Automatically start a discussion thread for this doubt!
    await sentMsg.startThread({ 
        name: `Doubt - ${message.author.username}`, 
        autoArchiveDuration: 1440, 
        reason: 'Doubt Thread' 
    });
    return;

    }

    
  if (content.startsWith('review ')) {
    if (!featureToggles.review) return message.reply('⚠️ The admin has stopped or paused this service.');
    if (message.channel.id !== process.env.GENERAL_CHANNEL_ID) {
      return message.reply('⚠️ This command only works in the contest channel!');
    }
    const currentDate = new Date().toDateString();
    if (currentDate !== aiDate) { dailyReviewCount = 0; dailyResumeCount = 0; aiDate = currentDate; }
    if (dailyReviewCount >= 5) return message.reply('⏸️ You have reached the maximum of 5 Code Reviews for today. Please wait until tomorrow!');
    
    const codeToReview = message.content.slice('review '.length).trim();
    if (!codeToReview) return message.reply('Please provide the code you want reviewed.');
    
    await message.channel.sendTyping();
    const reviewResult = await reviewUserCode(codeToReview);
    dailyReviewCount++;
    return message.reply({ content: reviewResult.substring(0, 2000) });
  }

  if (content.startsWith('resume ')) {
    if (!featureToggles.resume) return message.reply('⚠️ The admin has stopped or paused this service.');
    if (message.channel.id !== process.env.GENERAL_CHANNEL_ID) {
      return message.reply('⚠️ This command only works in the contest channel!');
    }
    const currentDate = new Date().toDateString();
    if (currentDate !== aiDate) { dailyReviewCount = 0; dailyResumeCount = 0; aiDate = currentDate; }
    if (dailyResumeCount >= 5) return message.reply('⏸️ You have reached the maximum of 5 Resume Reviews for today. Please wait until tomorrow!');
    
    const resumeText = message.content.slice('resume '.length).trim();
    if (!resumeText) return message.reply('Please paste the plaintext of your resume.');
    
    await message.channel.sendTyping();
    const resumeResult = await analyzeResumeForInterview(resumeText);
    dailyResumeCount++;
    return message.reply({ content: resumeResult.substring(0, 2000) });
  }

if (content === 'cheatsheet') {
    if (!featureToggles.cheatsheet) return message.reply('⚠️ The admin has stopped or paused this service.');
    const rmChannelId = process.env.ROADMAP_CHANNEL_ID;
    if (message.channel.id !== rmChannelId) {
        return message.reply(`⚠️ Please use cheat-sheets in the <#${rmChannelId}> channel!`);
    }

    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

    const select = new StringSelectMenuBuilder()
        .setCustomId('cheatsheet_select')
        .setPlaceholder('Select a subject...')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Operating System (OS)').setValue('OS'),
            new StringSelectMenuOptionBuilder().setLabel('DBMS (Database Management System)').setValue('DBMS'),
            new StringSelectMenuOptionBuilder().setLabel('Computer Networks (CN)').setValue('CN'),
            new StringSelectMenuOptionBuilder().setLabel('Object-Oriented Programming (OOP)').setValue('OOP'),
            new StringSelectMenuOptionBuilder().setLabel('Data Structures & Algorithms (DSA)').setValue('DSA'),
            new StringSelectMenuOptionBuilder().setLabel('Software Engineering (SE)').setValue('SE'),
            new StringSelectMenuOptionBuilder().setLabel('Compiler Design').setValue('Compiler Design'),
            new StringSelectMenuOptionBuilder().setLabel('Computer Organization & Architecture').setValue('COA'),
            new StringSelectMenuOptionBuilder().setLabel('Theory of Computation (TOC)').setValue('TOC'),
            new StringSelectMenuOptionBuilder().setLabel('Discrete Mathematics').setValue('Discrete Mathematics'),
            new StringSelectMenuOptionBuilder().setLabel('Artificial Intelligence (AI)').setValue('AI'),
            new StringSelectMenuOptionBuilder().setLabel('Machine Learning (ML)').setValue('ML'),
            new StringSelectMenuOptionBuilder().setLabel('Cyber Security').setValue('Cyber Security'),
            new StringSelectMenuOptionBuilder().setLabel('Web Development').setValue('Web Development'),
            new StringSelectMenuOptionBuilder().setLabel('System Design').setValue('System Design'),
            new StringSelectMenuOptionBuilder().setLabel('Cloud Computing').setValue('Cloud Computing'),
            new StringSelectMenuOptionBuilder().setLabel('DevOps').setValue('DevOps'),
            new StringSelectMenuOptionBuilder().setLabel('Blockchain').setValue('Blockchain'),
            new StringSelectMenuOptionBuilder().setLabel('Data Mining').setValue('Data Mining'),
            new StringSelectMenuOptionBuilder().setLabel('Big Data').setValue('Big Data')
        );

    const row = new ActionRowBuilder().addComponents(select);

    const embed = new EmbedBuilder()
      .setColor(0x00FFFF)
      .setTitle("📚 Study Cheatsheets")
      .setDescription("Select a subject from the dropout menu to generate or view a cheatsheet!");

    return message.reply({ embeds: [embed], components: [row] });
  }

  if (content === 'roadmap') {
    if (!featureToggles.roadmap) return message.reply('⚠️ The admin has stopped or paused this service.');
    const rmChannelId = process.env.ROADMAP_CHANNEL_ID;
    if (message.channel.id !== rmChannelId) {
        return message.reply(`⚠️ Please use the roadmap command in the <#${rmChannelId}> channel!`);
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("🗺️ Internship & Career Roadmaps")
      .setDescription("Choose a career path below to get a step-by-step guidance system for what to study!")
      .setFooter({ text: "Click a button to view the roadmap" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rm_frontend').setLabel('Frontend Dev').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rm_backend').setLabel('Backend Dev').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rm_dsa').setLabel('DSA / Interview').setStyle(ButtonStyle.Danger)
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  if (content === 'battle') {
    if (!featureToggles.battle) return message.reply('⚠️ The admin has stopped or paused this service.');
    const battleChannelId = process.env.BATTLE_MODE_ID;
    if (message.channel.id !== battleChannelId) {
        return message.reply(`⚠️ Battle mode can only be started in the <#${battleChannelId}> channel!`);
    }

    try { await message.delete(); } catch(e) {}

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join_battle').setLabel('Join Battle').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('start_battle').setLabel('Start Now').setStyle(ButtonStyle.Primary)
    );

    const lobbyEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⚔️ BATTLE LOBBY')
        .setDescription('A **20-question** trivia battle is starting!\n\nClick **Join Battle** to participate.\n*Need at least 2 players to begin.*\n\nLobby closes in 30 seconds...');

    const lobbyMsg = await message.channel.send({ embeds: [lobbyEmbed], components: [row] });
    const players = new Map();
    players.set(message.author.id, message.author.username); 
    const lobbyCollector = lobbyMsg.createMessageComponentCollector({ time: 30000 });
    let isBattleStopped = false; 

    const battleLoop = async () => {
        if (players.size < 2) return message.channel.send("⏱ Not enough players joined. Minimum 2 players required. Battle cancelled.");
        
        await message.channel.send(`🚀 **Battle starting with ${players.size} players!** 20 questions, first to answer gets a point.`);
        const scores = {};
        players.forEach((name, id) => scores[id] = 0);
        const TOTAL_QUESTIONS = 20;

        for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
            if (isBattleStopped) break; 
            await new Promise(r => setTimeout(r, 3000)); 
            if (isBattleStopped) break; 

            const q = await getInterviewQuestion();
            if (!q) { await message.channel.send("Failed to fetch a question, skipping..."); continue; }

            const qEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`⚔️ BATTLE: Question ${i} / ${TOTAL_QUESTIONS}`)
                .setDescription(`**${q.question}**\n\nType your answer in the chat! You have **20 seconds**.`)
                .addFields({ name: 'Category', value: q.category || 'General', inline: true })
                .setFooter({ text: 'Quick, time is ticking!' });

            const stopRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('stop_battle').setLabel('Stop Battle').setStyle(ButtonStyle.Danger)
            );
            const qMsg = await message.channel.send({ embeds: [qEmbed], components: [stopRow] });

            const filter = m => players.has(m.author.id) && !m.author.bot;      
            await new Promise((resolve) => {
                const qCollector = message.channel.createMessageCollector({ filter, time: 20000 });
                const stopFilter = i => i.customId === 'stop_battle' && players.has(i.user.id);
                const btnCollector = qMsg.createMessageComponentCollector({ filter: stopFilter, time: 20000 });
                let questionWinner = null;

                btnCollector.on('collect', async i => {
                    isBattleStopped = true;
                    await i.reply({ content: `🛑 Battle stopped by ${i.user.username}!`, ephemeral: false });
                    qCollector.stop('force_stopped');
                });

                qCollector.on('collect', async m => {
                    let isCorrect = false;
                    const userA = m.content.toLowerCase().trim();
                    if (userA === 'stop') {
                        isBattleStopped = true;
                        await message.channel.send(`🛑 Battle stopped by ${m.author.username}!`);
                        qCollector.stop('force_stopped');
                        return;
                    }
                    const correctA = q.exactAnswer ? q.exactAnswer.toLowerCase().trim() : null;
                    if (correctA) {
                        if (userA === correctA) isCorrect = true;
                        else if (q.optionsList && q.optionsList.length > 0) { 
                            const idx = q.optionsList.findIndex(opt => opt.toLowerCase().trim() === correctA);
                            if (idx !== -1 && userA === (idx + 1).toString()) isCorrect = true;
                        }
                        if (isCorrect) { questionWinner = m; qCollector.stop('winner'); }
                    }
                });

                qCollector.on('end', async (collected, reason) => {
                    btnCollector.stop();
                    try { await qMsg.edit({ components: [] }); } catch(err) {}  
                    if (reason === 'force_stopped') { resolve(); return; }
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
            .setTitle(isBattleStopped ? "🛑 BATTLE STOPPED EARLY" : "🏁 BATTLE OVER! 🏁")
            .setDescription(`Here are the final scores:\n\n${leaderboardText}`);

        if (winnerScore > 0) {
            let user = await User.findOne({ discordId: winnerId });
            if (!user) user = new User({ discordId: winnerId, username: players.get(winnerId) });
            user.battleWins = (user.battleWins || 0) + 1;
            user.mastery.General += 15; 
            await user.save();
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
                await i.reply({ content: "You already joined!", ephemeral: true });
            }
        }
        if (i.customId === 'start_battle') {
            if (i.user.id !== message.author.id) return i.reply({ content: "Only the creator can start it early!", ephemeral: true });
            lobbyCollector.stop('early_start');
        }
    });

    lobbyCollector.on('end', async (collected, reason) => {
        try { await lobbyMsg.edit({ components: [] }); } catch(err) {}
        battleLoop();
    });
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

// Interactions (Buttons & Modals)
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('submitans_')) {
        const doubtId = interaction.customId.split('_')[1];
        const answerText = interaction.fields.getTextInputValue('answerText');
        const doubt = await Doubt.findById(doubtId);
        
        if (!doubt) return interaction.reply({ content: 'Doubt not found.', ephemeral: true });
        
        const doubtChannelId = process.env.DOUBT_CHANNEL_ID;
        const channel = client.channels.cache.get(doubtChannelId);
        if (channel) {
            await channel.send(`✅ <@${doubt.askerId}>, your doubt has been answered by <@${interaction.user.id}>!\n\n**Q:** ${doubt.question}\n**A:** ${answerText}`);
        }
        
        doubt.status = 'Resolved';
        await doubt.save();
        
        return interaction.reply({ content: 'Your answer has been submitted and the doubt is marked resolved!', ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'cheatsheet_select') {
      const topic = interaction.values[0];
      await interaction.deferReply();
      
      try {
          const Cheatsheet = require('./models/Cheatsheet');
          let sheet = await Cheatsheet.findOne({ topic });
          
          let contentToSend = "";
          let isNew = false;
          
          if (sheet) {
              contentToSend = sheet.content;
          } else {
              const { getGeminiCheatsheet } = require('./questions/gemini');
              contentToSend = await getGeminiCheatsheet(topic);
              const newSheet = new Cheatsheet({ topic, content: contentToSend });
              await newSheet.save();
              isNew = true;
          }
          
          // Chunk the long cheatsheet into 1900-character blocks to bypass Discord limits
          const chunks = contentToSend.match(/(.|[\r\n]){1,1900}/g) || ["No content generated."];
          
          await interaction.editReply({ content: `**${topic} Cheatsheet** (${isNew ? 'Newly generated' : 'Loaded from database'}):\n\n${chunks[0]}` });
          
          for (let i = 1; i < chunks.length; i++) {
              await interaction.followUp({ content: chunks[i] });
          }
      } catch(e) {
          console.error(e);
          return interaction.editReply({ content: "Failed to fetch cheatsheet." });
      }
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('toggle_')) {
      const feature = interaction.customId.replace('toggle_', '');
      const adminChannelId = process.env.ADMIN_CHANNEL_ID || '1488553134463914147';
      
      if (interaction.channel.id !== adminChannelId) {
          return interaction.reply({ content: "You do not have permission to use admin toggles.", ephemeral: true });
      }

      if (featureToggles[feature] !== undefined) {
          featureToggles[feature] = !featureToggles[feature];
          const isEnabled = featureToggles[feature];
          const status = isEnabled ? 'resumed' : 'paused';

          // Rebuild the rows based on new state
          const row1 = new ActionRowBuilder();
          const row2 = new ActionRowBuilder();

          let i = 0;
          for (const [fName, state] of Object.entries(featureToggles)) {
              const btn = new ButtonBuilder()
                .setCustomId(`toggle_${fName}`)
                .setLabel(`${fName.toUpperCase()} [${state ? 'ON' : 'OFF'}]`)
                .setStyle(state ? ButtonStyle.Success : ButtonStyle.Danger);

              if (i < 5) row1.addComponents(btn);
              else row2.addComponents(btn);
              i++;
          }

          const components = row2.components.length > 0 ? [row1, row2] : [row1];

          await interaction.update({ components });

          const broadcastChannels = [
              process.env.GENERAL_CHANNEL_ID,
              process.env.CONTEST_CHANNEL_ID,
              process.env.ROADMAP_CHANNEL_ID,
              process.env.DOUBT_CHANNEL_ID,
              process.env.BATTLE_MODE_ID,
              process.env.CHANNEL_ID
          ].filter(v => v);

          const uniqueChannels = [...new Set(broadcastChannels)];

          for (const chId of uniqueChannels) {
              try {
                  const channel = await client.channels.fetch(chId);
                  if (channel) {
                      await channel.send(`📢 **Admin Announcement:** The service **${feature}** has been ${status} by the admin.`);
                  }
              } catch(e) {}
          }
      }
      return;
    }

    if (interaction.customId.startsWith('answer_')) {
      const doubtId = interaction.customId.split('_')[1];
      const doubt = await Doubt.findById(doubtId);
      if (!doubt || doubt.status !== 'Open') {
          return interaction.reply({ content: "This doubt is no longer open or doesn't exist.", ephemeral: true });
      }

      const modal = new ModalBuilder()
          .setCustomId(`submitans_${doubtId}`)
          .setTitle(`Answer Doubt`);

      const answerInput = new TextInputBuilder()
          .setCustomId('answerText')
          .setLabel("Your Answer:")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

      const row = new ActionRowBuilder().addComponents(answerInput);
      modal.addComponents(row);

      return interaction.showModal(modal);
    }
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
          await interaction.deferReply({ ephemeral: true });

          const repoMap = {
              'frontend': 'frontend',
              'backend': 'backend',
              'dsa': 'datastructures-and-algorithms'
          };
          const repoFolder = repoMap[path] || path;

          try {
              const url = `https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/${repoFolder}/${repoFolder}.md`;
              const response = await fetch(url);
              
              if (!response.ok) throw new Error("Fetch failed");
              const text = await response.text();
              
              const titleMatch = text.match(/briefTitle:\s*['"](.*?)['"]/);
              const descMatch = text.match(/description:\s*['"](.*?)['"]/);
              
              const title = titleMatch ? titleMatch[1] : repoFolder.toUpperCase();
              let desc = descMatch ? descMatch[1] : "Detailed roadmap guide.";

              const embed = new EmbedBuilder()
                  .setColor(0x9B59B6)
                  .setTitle(`🔥 ${title} Roadmap`)
                  .setDescription(`**${desc}**\n\n📌 *Data synced directly from the open-source \`developer-roadmap\` GitHub repository!*\n\nClick the button below to launch the official interactive step-by-step guidance system for this career path!`)
                  .setFooter({ text: 'Internship Roadmap Mode - powered by roadmap.sh' });               

              const linkBtn = new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setLabel(`View Full Interactive Map`).setStyle(ButtonStyle.Link).setURL(`https://roadmap.sh/${repoFolder}`)
              );

              return interaction.editReply({ embeds: [embed], components: [linkBtn] });
          } catch(e) {
              // Fallback local file
              let roadmaps = require('./data/roadmaps.json');
              if (roadmaps[path]) {
                  const embed = new EmbedBuilder()
                      .setColor(roadmaps[path].color)
                      .setTitle(roadmaps[path].title)
                      .setDescription(roadmaps[path].description)
                      .setFooter({ text: 'Local Fallback Map' });
                  return interaction.editReply({ embeds: [embed] });
              }
              return interaction.editReply({ content: "Roadmap unavailable." });
          }
      }

    } catch (err) {
      console.error('Error handling button interaction:', err);
    }
});

// Login
client.login(process.env.TOKEN);