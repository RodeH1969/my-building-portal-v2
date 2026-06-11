const cron = require('node-cron');
const { db } = require('../config/firebase');
const email = require('./email');
const { finalizeApplication } = require('./voting');

// Run every hour
function startCronJobs() {
  cron.schedule('0 * * * *', async () => {
    console.log('=== HOURLY SWEEP START ===', new Date().toISOString());
    await runSweep();
  });

  // Also run pending questions check every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    const { processPendingQuestions } = require('./voting');
    await processPendingQuestions().catch(err => console.error('Pending Q check failed:', err.message));
  });

  console.log('Cron jobs started');
}

async function runSweep() {
  try {
    const now = new Date();

    // Get Brisbane hour (UTC+10, no DST in QLD)
    const brisbaneHour = new Date(now.getTime() + 10 * 60 * 60 * 1000).getUTCHours();
    const isNineAM = brisbaneHour === 9;

    // Fetch all active applications
    const snap = await db.ref('applications').once('value');
    if (!snap.exists()) return;

    const applications = snap.val();

    for (const [appId, app] of Object.entries(applications)) {
      if (!['pending_vote', 'awaiting_info'].includes(app.status)) continue;

      const submittedAt = new Date(app.submittedAt);
      const daysElapsed = Math.floor((now - submittedAt) / (1000 * 60 * 60 * 24));

      // ─── 14-DAY LAPSE ───
      if (daysElapsed >= 14 && app.status === 'pending_vote') {
        console.log(`Lapsing application ${appId} after ${daysElapsed} days`);
        await db.ref(`applications/${appId}`).update({
          status: 'lapsed',
          outcome: 'lapsed',
          outcomeAt: now.toISOString(),
          lastUpdatedAt: now.toISOString()
        });
        const freshSnap = await db.ref(`applications/${appId}`).once('value');
        await finalizeApplication(appId, freshSnap.val());
        await email.notifyManagerLapsed(freshSnap.val());
        await email.sendLapsedToApplicant(freshSnap.val());
        continue;
      }

      // ─── 7-DAY STUCK ALERT (fires once only) ───
      if (daysElapsed >= 7 && !app.managerStuckNotified && app.status === 'pending_vote') {
        console.log(`Sending stuck alert for ${appId}`);
        await email.notifyManagerStuck(app);
        await db.ref(`applications/${appId}/managerStuckNotified`).set(true);
      }

      // ─── 9AM DAILY REMINDERS ───
      if (isNineAM && app.status === 'pending_vote') {
        const members = app.committeeSnapshot && app.committeeSnapshot.members ? app.committeeSnapshot.members : [];

        for (const m of members) {
          const memberVote = app.votes && app.votes[m.id];
          const hasVoted = memberVote && memberVote.vote && memberVote.vote !== null;
          if (hasVoted) continue;

          // Get member's access token
          const mSnap = await db.ref(`committee_members/${m.id}`).once('value');
          if (!mSnap.exists() || !mSnap.val().active) continue;

          const memberData = mSnap.val();
          const dayNumber = daysElapsed + 1;

          await email.sendDailyReminder(
            { ...m, accessToken: memberData.accessToken, email: memberData.email },
            app,
            dayNumber
          ).catch(err => console.error(`Reminder failed for ${m.name}:`, err.message));

          // Small delay between emails
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    console.log('=== HOURLY SWEEP COMPLETE ===');
  } catch (err) {
    console.error('Sweep error:', err.message);
  }
}

module.exports = { startCronJobs, runSweep };