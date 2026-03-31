const { EmbedBuilder } = require('discord.js');

// Store notified contests so we don't spam
const notified30Mins = new Set();
const notifiedOver = new Set();

async function checkContests(client) {
    const channelId = process.env.CONTEST_CHANNEL_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const now = Date.now() / 1000; // in seconds

        let allContests = [];

        // 1. Codeforces
        try {
            const cfRes = await fetch('https://codeforces.com/api/contest.list');
            const cfData = await cfRes.json();
            if (cfData.status === 'OK') {
                const pending = cfData.result.filter(c => c.phase === 'BEFORE');
                pending.forEach(c => {
                    allContests.push({
                        id: `CF_${c.id}`,
                        name: c.name,
                        platform: 'Codeforces',
                        startTime: c.startTimeSeconds,
                        endTime: c.startTimeSeconds + c.durationSeconds,
                        url: `https://codeforces.com/contests/${c.id}`
                    });
                });
            }
        } catch (e) { console.error("CF Fetch Error", e); }

        // 2. Leetcode
        try {
            const lcRes = await fetch('https://leetcode.com/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ allContests { title startTime duration } }' })
            });
            const lcData = await lcRes.json();
            if (lcData && lcData.data && lcData.data.allContests) {
                lcData.data.allContests.forEach(c => {
                    allContests.push({
                        id: `LC_${c.title.replace(/\s+/g, '')}`,
                        name: c.title,
                        platform: 'LeetCode',
                        startTime: c.startTime,
                        endTime: c.startTime + c.duration,
                        url: 'https://leetcode.com/contest/'
                    });
                });
            }
        } catch (e) { console.error("LC Fetch Error", e); }

        // 3. CodeChef
        try {
            const ccRes = await fetch('https://www.codechef.com/api/list/contests/all');
            const ccData = await ccRes.json();
            if (ccData && ccData.future_contests) {
                ccData.future_contests.forEach(c => {
                    const st = new Date(c.contest_start_date_iso).getTime() / 1000;
                    const et = new Date(c.contest_end_date_iso).getTime() / 1000;
                    allContests.push({
                        id: `CC_${c.contest_code}`,
                        name: c.contest_name,
                        platform: 'CodeChef',
                        startTime: st,
                        endTime: et,
                        url: `https://www.codechef.com/${c.contest_code}`
                    });
                });
            }
        } catch (e) { console.error("CC Fetch Error", e); }

        // Process contests
        for (const c of allContests) {
            // Check 30 min before
            const timeUntilStart = c.startTime - now;
            // Between 25 to 35 minutes
            if (timeUntilStart > 0 && timeUntilStart <= 35 * 60 && timeUntilStart > 25 * 60) {
                if (!notified30Mins.has(c.id)) {
                    notified30Mins.add(c.id);
                    const embed = new EmbedBuilder()
                        .setColor(0xF1C40F)
                        .setTitle(`🚨 Upcoming Contest: ${c.name}`)
                        .setDescription(`**${c.platform}** contest starts in about 30 minutes!`)
                        .addFields(
                            { name: 'Duration', value: `${(c.endTime - c.startTime) / 60} mins`, inline: true },
                            { name: 'Link', value: c.url, inline: true }
                        )
                        .setFooter({ text: 'Get ready to code! 🚀' });
                    
                    await channel.send({ content: '@everyone ⏳ Contest starting soon!', embeds: [embed] });
                }
            }

            // Check if just ended (within last 10 minutes)
            const timeSinceEnd = now - c.endTime;
            if (timeSinceEnd > 0 && timeSinceEnd <= 10 * 60) {
                if (!notifiedOver.has(c.id)) {
                    notifiedOver.add(c.id);
                    const embed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle(`🏁 Contest Ended: ${c.name}`)
                        .setDescription(`**${c.platform}** contest has officially concluded!\n\n**Discuss & Share Answers:**\nPlease upload your approaches, code snippets, or solutions here. You can also use the \`review <code...>\` command in the General channel to have the AI review your solutions!`)
                        .setFooter({ text: 'Awaiting your solutions...' });
                    
                    await channel.send({ content: '@everyone 🏁 Contest is over!', embeds: [embed] });
                }
            }
        }

    } catch (err) {
        console.error("Contest Tracker Error:", err);
    }
}

function startContestTracker(client) {
    // Run every 5 minutes
    setInterval(() => {
        checkContests(client);
    }, 5 * 60 * 1000);
    // Initial run
    checkContests(client);
}

module.exports = { startContestTracker };