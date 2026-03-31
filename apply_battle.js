const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const battleStart = content.indexOf(`  if (content === 'battle') {`);
const helpStart = content.indexOf(`  if (content === 'hello' || content === 'help') {`);

if (battleStart === -1 || helpStart === -1) {
    console.error("Could not find bounds");
    process.exit(1);
}

const newBattleBlock = `  if (content === 'battle') {
    const battleChannelId = process.env.BATTLE_MODE_ID;
    if (message.channel.id !== battleChannelId) {
        return message.reply(\`⚠️ Battle mode can only be started in the <#\${battleChannelId}> channel!\`);
    }

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
        .setDescription('A **20-question** trivia battle is starting!\\n\\nClick **Join Battle** to participate.\\n*Need at least 2 players to begin.*\\n\\nLobby closes in 30 seconds...');

    const lobbyMsg = await message.channel.send({ embeds: [lobbyEmbed], components: [row] });
    
    // Store players participating: discordId -> username
    const players = new Map();
    players.set(message.author.id, message.author.username); // Creator auto joins
    
    const lobbyCollector = lobbyMsg.createMessageComponentCollector({ time: 30000 });

    let isBattleStopped = false; // Flag to handle early stops

    const battleLoop = async () => {
        if (players.size < 2) {
            return message.channel.send("❌ Not enough players joined. Minimum 2 players required. Battle cancelled.");
        }
        
        await message.channel.send(\`🚀 **Battle starting with \${players.size} players!** 20 questions, first to answer gets a point.\\n\\nYou can stop the battle midway using the Stop button below each question or by typing "stop". (Wait 3 seconds for the first question...)\`);
        
        // Track scores
        const scores = {};
        players.forEach((name, id) => scores[id] = 0);
        
        const TOTAL_QUESTIONS = 20;

        for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
            if (isBattleStopped) break; // Exit loop if stopped
            
            await new Promise(r => setTimeout(r, 3000)); // 3 sec pause between questions
            
            if (isBattleStopped) break; // Double check after sleep

            const q = await getInterviewQuestion();
            if (!q) {
                await message.channel.send("Failed to fetch a question, skipping...");
                continue;
            }

            const qEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(\`⚔️ BATTLE: Question \${i} / \${TOTAL_QUESTIONS}\`)
                .setDescription(\`**\${q.question}**\\n\\nType your answer in the chat! You have **20 seconds**.\`)
                .addFields({ name: 'Category', value: q.category, inline: true })
                .setFooter({ text: 'Quick, time is ticking!' });

            const stopRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('stop_battle')
                    .setLabel('Stop Battle')
                    .setStyle(ButtonStyle.Danger)
            );

            const qMsg = await message.channel.send({ embeds: [qEmbed], components: [stopRow] });

            const filter = m => players.has(m.author.id) && !m.author.bot;
            
            await new Promise((resolve) => {
                const qCollector = message.channel.createMessageCollector({ filter, time: 20000 });
                
                const stopFilter = i => i.customId === 'stop_battle' && players.has(i.user.id);
                const btnCollector = qMsg.createMessageComponentCollector({ filter: stopFilter, time: 20000 });

                let questionWinner = null;
                let stoppedBy = null;

                btnCollector.on('collect', async i => {
                    isBattleStopped = true;
                    stoppedBy = i.user.username;
                    await i.reply({ content: \`🛑 Battle stopped by \${i.user.username}!\`, ephemeral: false });
                    qCollector.stop('force_stopped');
                });

                qCollector.on('collect', async m => {
                    let isCorrect = false;
                    const userA = m.content.toLowerCase().trim();

                    if (userA === 'stop') {
                        isBattleStopped = true;
                        stoppedBy = m.author.username;
                        await message.channel.send(\`🛑 Battle stopped by \${m.author.username} typing stop!\`);
                        qCollector.stop('force_stopped');
                        return;
                    }

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
                    btnCollector.stop();
                    try { await qMsg.edit({ components: [] }); } catch(err) {}

                    if (reason === 'force_stopped') {
                        resolve();
                        return;
                    }

                    if (reason === 'winner' && questionWinner) {
                        const winnerId = questionWinner.author.id;
                        scores[winnerId] += 1;
                        await message.channel.send(\`✅ **\${questionWinner.author.username}** got it! (+1 pt)\\nCorrect answer was: **\${q.exactAnswer}**\`);
                    } else {
                        await message.channel.send(\`⏰ Time's up! Nobody got it.\\nCorrect answer was: **\${q.exactAnswer || "Unknown"}**\`);
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
            leaderboardText += \`\${medal} **\${players.get(id)}**: \${score} pts\\n\`;
        });

        const finalEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(isBattleStopped ? "🛑 BATTLE STOPPED EARLY" : "🏁 BATTLE OVER! 🏁")
            .setDescription(\`Here are the final scores:\\n\\n\${leaderboardText}\`);

        if (winnerScore > 0) {
            // Update db for the winner
            let user = await User.findOne({ discordId: winnerId });
            if (!user) {
                user = new User({ discordId: winnerId, username: players.get(winnerId) });
            }
            user.battleWins = (user.battleWins || 0) + 1;
            user.mastery.General += 15; // Give 15 XP for winning
            await user.save();
            finalEmbed.addFields({ name: 'Rewards', value: \`**\${players.get(winnerId)}** receives +15 General XP and +1 Battle Win!\` });
        } else {
            finalEmbed.addFields({ name: 'Rewards', value: "Nobody scored any points! No rewards given." });
        }

        await message.channel.send({ embeds: [finalEmbed] });
    };

    lobbyCollector.on('collect', async (i) => {
        if (i.customId === 'join_battle') {
            if (!players.has(i.user.id)) {
                players.set(i.user.id, i.user.username);
                await i.reply({ content: \`✅ \${i.user.username} joined! Total players: \${players.size}\`, ephemeral: false });
            } else {
                await i.reply({ content: \`You are already in the lobby!\`, ephemeral: true });
            }
        } else if (i.customId === 'start_battle') {
            if (i.user.id === message.author.id) {
                lobbyCollector.stop('forced');
            } else {
                await i.reply({ content: \`Only \${message.author.username} can force start early.\`, ephemeral: true });
            }
        }
    });

    lobbyCollector.on('end', async () => {
        try { await lobbyMsg.edit({ components: [] }); } catch(e) {}
        await battleLoop();
    });

    return;
  }

`;

const newContent = content.substring(0, battleStart) + newBattleBlock + content.substring(helpStart);

fs.writeFileSync('index.js', newContent);
console.log("Successfully patched index.js with combined text and button stop block");