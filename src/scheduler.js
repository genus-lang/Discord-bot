const cron = require('node-cron');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getCodingQuestion } = require('./questions/coding');
const { getInterviewQuestion } = require('./questions/interview');

function normalizeCategory(categoryStr) {
    if (!categoryStr) return 'General';
    const lower = categoryStr.toLowerCase();
    if (lower.includes('data structure') || lower.includes('algorithm')) return 'DSA';
    if (lower.includes('operating system')) return 'OS';
    if (lower.includes('database') || lower.includes('sql')) return 'DBMS';
    if (lower.includes('web') || lower.includes('frontend') || lower.includes('backend')) return 'WebDev';
    if (lower.includes('competitive')) return 'CP';
    return 'General';
}

async function getChannel(client) {
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) {
        console.warn('⚠️  CHANNEL_ID not set in .env — use !setchannel in Discord to configure.');
        return null;
    }
    try {
        const channel = await client.channels.fetch(channelId);
        return channel;
    } catch(err) {
        console.error('⚠️ Failed to fetch CHANNEL_ID:', err.message);
        return null;
    }
}

async function buildCodingPayload() {
    const q = await getCodingQuestion();
    if (!q) return null;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`💻 Coding Challenge — ${q.title}`)
        .setDescription(q.question)
        .addFields(
            { name: '📊 Difficulty', value: q.difficulty, inline: true },
            { name: '🏷️ Topic', value: q.topic, inline: true },
            { name: '🧪 Example', value: '```\n' + q.example + '\n```' },
            { name: '💡 Hint', value: `||${q.hint}||` },
        )
        .setFooter({ text: 'Click the title link to try it!' })
        .setTimestamp();

    if (q.link) embed.setURL(q.link);

    const normCat = normalizeCategory(q.topic);
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('next_coding')
            .setLabel('Another Question')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`learned_${normCat}`)
            .setLabel('I knew this! (+1 XP)')
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
}

async function buildInterviewPayload() {
    const q = await getInterviewQuestion();
    if (!q) return null;

    const titlePrefix = q.type === "Curated CS" ? "🎯 Core CS Interview" : "🎯 Daily Trivia";

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`${titlePrefix}`)
        .setDescription(`**${q.question}**`)
        .addFields(
            { name: '🏷️ Category', value: q.category, inline: true },
            { name: '📊 Difficulty', value: q.difficulty, inline: true },
            { name: '🔍 Source', value: q.type || "Unknown", inline: true },
            { name: '✅ Answer', value: q.advice.substring(0, 1024) },
        )
        .setFooter({ text: 'Test your knowledge!' })
        .setTimestamp();

    const normCat = normalizeCategory(q.category);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('next_interview')
            .setLabel('Another Question')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`learned_${normCat}`)
            .setLabel('I knew this! (+1 XP)')
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
}

async function buildCompanyPayload(company) {
    const q = getCompanyQuestion(company);
    if (!q) return { content: `No questions found for ${company} right now.` };

    const embed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle(`🏢 ${company.toUpperCase()} Interview Prep`)
        .setDescription(`**${q.question}**`)
        .addFields(
            { name: '🏷️ Topic', value: q.topic, inline: true },
            { name: '📊 Difficulty', value: q.difficulty, inline: true },
            { name: '✅ Answer', value: q.advice.substring(0, 1024) },
        )
        .setFooter({ text: 'Company specific placement preparation!' })
        .setTimestamp();

    const normCat = normalizeCategory(q.topic);
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`next_${company}`)
            .setLabel('Another Question')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`learned_${normCat}`)
            .setLabel('I knew this! (+1 XP)')
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
}

async function sendCodingQuestion(client) {
    const ch = await getChannel(client);
    if (!ch) return;

    const payload = await buildCodingPayload();
    if (payload) {
        await ch.send(payload);
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Sent coding question`);
    }
}

async function sendInterviewQuestion(client) {
    const ch = await getChannel(client);
    if (!ch) return;

    const payload = await buildInterviewPayload();
    if (payload) {
        await ch.send(payload);
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Sent interview trivia`);
    }
}

function startScheduler(client) {
    // 3 times a day: 8:00 AM, 2:00 PM, 8:00 PM IST
    cron.schedule('0 8,14,20 * * *', () => {
        sendCodingQuestion(client);
        sendInterviewQuestion(client);
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('🕐 Scheduler started — Sending questions 3 times a day (8 AM, 2 PM, 8 PM IST)');
}

module.exports = { startScheduler, sendCodingQuestion, sendInterviewQuestion, buildCodingPayload, buildInterviewPayload, buildCompanyPayload };
