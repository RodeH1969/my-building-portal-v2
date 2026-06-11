const { db } = require('../config/firebase');
const { MAJORITY } = require('../config/committees');
const email = require('./email');
const pdf = require('./pdf');
const { v4: uuidv4 } = require('uuid');

// ─── CAST OR CHANGE VOTE ───
async function castVote(applicationId, memberId, voteType) {
  let triggerFinalization = false;
  let nextStatus = null;
  let previousVote = null;
  let appSnapshot = null;

  // Atomic transaction
  await db.ref(`applications/${applicationId}`).transaction(appData => {
    if (!appData) return appData;

    // Guard: locked states
    if (['approved', 'rejected', 'lapsed'].includes(appData.status)) {
      throw new Error('APPLICATION_LOCKED');
    }

    const votes = appData.votes || {};
    previousVote = votes[memberId] ? votes[memberId].vote : null;
    const now = new Date().toISOString();

    // Record vote
    votes[memberId] = {
      ...votes[memberId],
      vote: voteType,
      votedAt: now,
      changedFrom: (previousVote && previousVote !== voteType) ? previousVote : (votes[memberId] && votes[memberId].changedFrom) || null,
      changedAt: (previousVote && previousVote !== voteType) ? now : (votes[memberId] && votes[memberId].changedAt) || null
    };

    // Tally
    const allVotes = Object.values(votes);
    const approvals = allVotes.filter(v => v.vote === 'approve').length;
    const rejections = allVotes.filter(v => v.vote === 'reject').length;
    const required = appData.committeeSnapshot.requiredVotes;

    nextStatus = appData.status;

    if (approvals >= required) {
      nextStatus = 'approved';
      triggerFinalization = true;
    } else if (rejections >= required) {
      nextStatus = 'rejected';
      triggerFinalization = true;
    } else if (voteType === 'info' && appData.status === 'pending_vote') {
      nextStatus = 'awaiting_info';
    }

    appData.votes = votes;
    appData.status = nextStatus;
    appData.lastUpdatedAt = now;

    appSnapshot = { ...appData };
    return appData;
  });

  // Post-transaction actions
  const freshSnap = await db.ref(`applications/${applicationId}`).once('value');
  const app = freshSnap.val();

  if (triggerFinalization) {
    await finalizeApplication(applicationId, app);
  } else if (previousVote && previousVote !== voteType && voteType !== 'info') {
    await email.notifyManagerVoteChanged(app, app.votes[memberId].name || memberId, previousVote, voteType);
  }

  return { success: true, status: nextStatus, previousVote };
}

// ─── FINALIZE APPLICATION ───
async function finalizeApplication(applicationId, app) {
  const now = new Date().toISOString();

  // Build audit snapshot
  const voteBreakdown = app.committeeSnapshot.members.map(m => {
    const v = app.votes && app.votes[m.id];
    return {
      memberName: m.name,
      memberEmail: m.email,
      vote: v ? v.vote : null,
      votedAt: v ? v.votedAt : null,
      changedFrom: v ? v.changedFrom : null,
      changedAt: v ? v.changedAt : null
    };
  });

  const infoThread = app.infoThread ? Object.values(app.infoThread) : [];

  const auditSnapshot = {
    finalizedAt: now,
    outcome: app.outcome || app.status,
    totalEligible: app.committeeSnapshot.totalEligible,
    requiredVotes: app.committeeSnapshot.requiredVotes,
    voteBreakdown,
    infoThread,
    formDataSnapshot: app.formData || {}
  };

  await db.ref(`applications/${applicationId}/auditSnapshot`).set(auditSnapshot);

  // Get fresh app with audit snapshot
  const finalSnap = await db.ref(`applications/${applicationId}`).once('value');
  const finalApp = finalSnap.val();

  // Generate PDF
  try {
    const pdfUrl = await pdf.generateApplicationPDF(finalApp);
    await db.ref(`applications/${applicationId}/pdfUrl`).set(pdfUrl);
  } catch (err) {
    console.error('PDF generation failed:', err.message);
  }

  // Send emails
  await email.sendOutcomeToApplicant(finalApp);
  await email.notifyManagerOutcome(finalApp);

  // Notify committee of outcome
  const members = app.committeeSnapshot.members;
  for (let i = 0; i < members.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 300));
    const member = members[i];
    // Get member's access token
    const memberSnap = await db.ref(`committee_members/${member.id}`).once('value');
    if (memberSnap.exists()) {
      const memberData = memberSnap.val();
      const outcome = finalApp.outcome === 'approved' ? 'APPROVED ✓' : 'REJECTED ✗';
      try {
        const sgMail = require('@sendgrid/mail');
        const FROM = { email: process.env.SENDGRID_FROM, name: 'My Building Portal' };
        await sgMail.send({
          to: memberData.email,
          from: FROM,
          subject: `${outcome} — ${finalApp.formLabel} Lot ${finalApp.lot}, ${finalApp.building} [${finalApp.ref}]`,
          html: `<p style="font-family:Arial;font-size:13px;">Dear ${memberData.name}, the application has been <strong>${finalApp.outcome}</strong>. Log in to your portal to view the full record.</p>`
        });
      } catch (err) {
        console.error(`Outcome email failed for ${member.name}:`, err.message);
      }
    }
  }
}

// ─── PROCESS PENDING QUESTIONS (30-min consolidation) ───
async function processPendingQuestions() {
  const now = Date.now();
  const thirtyMin = 30 * 60 * 1000;

  const appsSnap = await db.ref('applications')
    .orderByChild('status')
    .equalTo('awaiting_info')
    .once('value');

  if (!appsSnap.exists()) return;

  for (const [appId, app] of Object.entries(appsSnap.val())) {
    const pending = app.pending_questions ? Object.entries(app.pending_questions) : [];
    const unsent = pending.filter(([, q]) => !q.sent);

    if (unsent.length === 0) continue;

    // Check oldest unsent question is > 30 mins old
    const oldest = unsent.reduce((min, [, q]) => new Date(q.askedAt) < new Date(min.askedAt) ? q : min, unsent[0][1]);
    if (now - new Date(oldest.askedAt).getTime() < thirtyMin) continue;

    // Check if this is first send or addendum
    const sentBefore = pending.some(([, q]) => q.sent);

    const questions = unsent.map(([, q]) => ({ memberName: q.memberName, question: q.question }));

    // Generate response token
    const responseToken = uuidv4();
    await db.ref(`response_tokens/${responseToken}`).set({
      applicationId: appId,
      type: 'applicant_response',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Send email
    if (!sentBefore) {
      await email.sendInfoRequestToApplicant(app, questions, responseToken);
    } else {
      // Addendum - questions added while already awaiting
      for (const q of questions) {
        await email.sendInfoAddendum(app, q);
      }
    }

    // Mark all as sent and move to infoThread
    const updates = {};
    for (const [qId, q] of unsent) {
      updates[`applications/${appId}/pending_questions/${qId}/sent`] = true;
      const threadId = uuidv4();
      updates[`applications/${appId}/infoThread/${threadId}`] = {
        type: sentBefore ? 'addendum' : 'question',
        memberId: q.memberId,
        memberName: q.memberName,
        content: q.question,
        timestamp: q.askedAt
      };
    }
    await db.ref().update(updates);

    // Store response token on application
    await db.ref(`applications/${appId}/activeResponseToken`).set(responseToken);

    console.log(`Processed ${unsent.length} pending questions for ${appId}`);
  }
}

// ─── SUBMIT INFO REQUEST (from portal) ───
async function submitInfoRequest(applicationId, memberId, memberName, question) {
  const questionId = uuidv4();
  const now = new Date().toISOString();

  await db.ref(`applications/${applicationId}/pending_questions/${questionId}`).set({
    questionId,
    memberId,
    memberName,
    question,
    askedAt: now,
    sent: false
  });

  // Update status to awaiting_info if not already
  await db.ref(`applications/${applicationId}`).update({
    status: 'awaiting_info',
    lastUpdatedAt: now
  });

  return { success: true, questionId };
}

// ─── PROCESS APPLICANT RESPONSE ───
async function processApplicantResponse(responseToken, responseText, attachments) {
  const tokenSnap = await db.ref(`response_tokens/${responseToken}`).once('value');
  if (!tokenSnap.exists()) throw new Error('INVALID_TOKEN');

  const tokenData = tokenSnap.val();
  if (new Date(tokenData.expiresAt) < new Date()) throw new Error('TOKEN_EXPIRED');

  const { applicationId } = tokenData;
  const now = new Date().toISOString();
  const entryId = uuidv4();

  // Write response to infoThread
  await db.ref(`applications/${applicationId}/infoThread/${entryId}`).set({
    type: 'response',
    memberId: null,
    memberName: 'Applicant',
    content: responseText,
    timestamp: now,
    attachments: attachments || []
  });

  // Return to pending_vote
  await db.ref(`applications/${applicationId}`).update({
    status: 'pending_vote',
    lastUpdatedAt: now,
    activeResponseToken: null
  });

  // Invalidate token
  await db.ref(`response_tokens/${responseToken}`).remove();

  // Get fresh app and notify committee
  const appSnap = await db.ref(`applications/${applicationId}`).once('value');
  const app = appSnap.val();

  // Get committee members with their access tokens
  const members = [];
  for (const m of app.committeeSnapshot.members) {
    const mSnap = await db.ref(`committee_members/${m.id}`).once('value');
    if (mSnap.exists() && mSnap.val().active) {
      members.push({ ...m, accessToken: mSnap.val().accessToken });
    }
  }

  await email.sendApplicantRespondedToCommittee(members, app);

  return { success: true, applicationId };
}

module.exports = {
  castVote,
  finalizeApplication,
  processPendingQuestions,
  submitInfoRequest,
  processApplicantResponse
};