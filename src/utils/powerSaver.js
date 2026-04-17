let lastActivity = Date.now();
let shutdownTimer = null;
const IDLE_TIMEOUT = (parseInt(process.env.IDLE_TIMEOUT_MINUTES) || 30) * 60 * 1000;

function initPowerSaver(client) {
    const mins = IDLE_TIMEOUT / 60000;
    console.log(`🔋 Power Saver initialized: Bot will sleep after ${mins} minutes of inactivity.`);
    
    // Check every minute
    shutdownTimer = setInterval(async () => {
        const idleTime = Date.now() - lastActivity;
        
        if (idleTime > IDLE_TIMEOUT) {
            console.log("💤 Inactivity threshold reached. Sleeping to save Railway hours...");
            
            try {
                if (client) {
                    await client.destroy(); // Properly log out from Discord
                }
            } catch (err) {
                console.error("Error during shutdown logout:", err);
            }
            
            process.exit(0); // Exit process - Railway will stop the container
        }
    }, 60000);
}

function resetActivityTimer() {
    lastActivity = Date.now();
}

module.exports = { initPowerSaver, resetActivityTimer };
