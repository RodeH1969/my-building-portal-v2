const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

const FROM = { email: process.env.SENDGRID_FROM, name: 'My Building Portal' };
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'airbrandr@gmail.com';

// ─── DELAY HELPER ───
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── EMAIL LOG HELPER ───
async function logEmail({ to, subject, type, applicationId, ref, buildingKey }) {
  try {
    const logId = uuidv4();
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const entry = {
      to: to || null,
      subject: subject || null,
      type: type || null,
      applicationId: applicationId || null,
      ref: ref || null,
      sentAt: now.toISOString()
    };
    if (buildingKey) {
      await db.ref(`email_log/${buildingKey}/${yearMonth}/${logId}`).set(entry);
    } else {
      await db.ref(`email_log/_general/${yearMonth}/${logId}`).set(entry);
    }
  } catch (err) {
    console.error('Email log failed:', err.message);
  }
}

// ─── BASE EMAIL WRAPPER ───
function baseEmail(content) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#1a3a5c;padding:18px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;font-size:18px;margin:0;font-family:Arial,sans-serif;">My Building Portal</h1>
        <p style="color:#c4a038;margin:3px 0 0;font-size:12px;">Queensland Body Corporate Management</p>
      </div>
      <div style="padding:24px;border:1px solid #e2e5ea;border-top:none;border-radius:0 0 8px 8px;">
        ${content}
        <p style="color:#c0c8d5;font-size:10px;margin-top:28px;padding-top:12px;border-top:1px solid #f0f2f5;">
          My Building Portal · Brisbane QLD · All records retained pursuant to s206 Body Corporate and Community Management Act 1997 (QLD)
        </p>
      </div>
    </div>
  `;
}

// ─── APP SUMMARY BOX ───
function appSummary(app) {
  return `
    <div style="background:#f4f5f7;border-radius:8px;padding:14px 16px;margin:14px 0;font-size:12px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#9aa3b2;padding:3px 0;width:130px;">Building</td><td style="color:#1a2333;font-weight:600;">${app.building}</td></tr>
        <tr><td style="color:#9aa3b2;padding:3px 0;">Lot</td><td style="color:#1a2333;font-weight:600;">${app.lot}</td></tr>
        <tr><td style="color:#9aa3b2;padding:3px 0;">Application</td><td style="color:#1a2333;font-weight:600;">${app.formLabel}</td></tr>
        <tr><td style="color:#9aa3b2;padding:3px 0;">Reference</td><td style="color:#1a2333;font-weight:600;">${app.ref}</td></tr>
        <tr><td style="color:#9aa3b2;padding:3px 0;">Applicant</td><td style="color:#1a2333;font-weight:600;">${app.submittedByName || 'Unknown'}</td></tr>
        <tr><td style="color:#9aa3b2;padding:3px 0;">Required votes</td><td style="color:#1a2333;font-weight:600;">${app.committeeSnapshot.requiredVotes} of ${app.committeeSnapshot.totalEligible}</td></tr>
      </table>
    </div>
  `;
}

// ─── ATTACHMENT LINKS ───
function attachmentLinks(app) {
  if (!app.attachments || app.attachments.length === 0) return '';
  const links = app.attachments.map(att => {
    const icon = att.contentType && att.contentType.startsWith('image/') ? '\U0001f5bc' : '\U0001f4c4';
    const sizeKb = att.size ? Math.round(att.size / 1024) + ' KB' : '';
    return `<tr><td style="padding:4px 0;"><a href="${att.url}" target="_blank" style="color:#1a5a9e;font-size:12px;text-decoration:none;font-weight:600;">${icon} ${att.originalName}</a></td><td style="color:#9aa3b2;font-size:11px;padding:4px 0 4px 10px;">${sizeKb}</td></tr>`;
  }).join('');
  return `
    <div style="background:#f0f5fc;border:1px solid #c5d8f5;border-radius:8px;padding:12px 14px;margin:12px 0;">
      <p style="font-size:11px;font-weight:700;color:#1a5a9e;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em;">Attachments (${app.attachments.length})</p>
      <table style="width:100%;border-collapse:collapse;">${links}</table>
    </div>
  `;
}

// ─── PORTAL BUTTON ───
function portalBtn(token, text) {
  return `
    <div style="text-align:center;margin:20px 0;">
      <a href="${BASE_URL}/portal/${token}" style="display:inline-block;background:#1a5a9e;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
        ${text || 'Open My Portal →'}
      </a>
    </div>
  `;
}

// ─── 1. WELCOME EMAIL TO NEW COMMITTEE MEMBER ───
async function sendWelcomeEmail(member, building) {
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      You have been added as a committee member for <strong>${building.name}</strong> on My Building Portal.
    </p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Your personal portal is where you will review and vote on all applications submitted by owners and residents. Please bookmark the link below — it is unique to you and does not require a password.
    </p>
    ${portalBtn(member.accessToken, 'Open My Portal →')}
    <div style="background:#fff3f0;border:1px solid #fcd4cc;border-radius:8px;padding:12px 14px;margin:14px 0;">
      <p style="font-size:12px;color:#d84a30;margin:0;font-weight:600;">⚠️ Keep this link private.</p>
      <p style="font-size:11px;color:#7a5c10;margin:4px 0 0;">Do not forward this email to residents or lot owners. If you believe your link has been compromised, contact the building manager immediately to have it regenerated.</p>
    </div>
    <p style="color:#5a6478;font-size:12px;line-height:1.6;">
      You will receive email notifications when new applications require your vote. All voting and application review takes place through your portal — not through email links.
    </p>
  `);

  await sgMail.send({
    to: member.email,
    from: FROM,
    subject: `Welcome to My Building Portal — ${building.name} Committee`,
    html
  });
  await logEmail({ to: member.email, subject: `Welcome — ${building.name} Committee`, type: 'welcome', buildingKey: member.buildingKey });
}

// ─── 2. NEW APPLICATION NOTIFICATION TO COMMITTEE MEMBERS ───
async function sendNewApplicationToCommittee(members, app) {
  for (let i = 0; i < members.length; i++) {
    if (i > 0) await delay(300);
    const member = members[i];
    const html = baseEmail(`
      <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
      <p style="color:#5a6478;font-size:13px;line-height:1.6;">
        A new <strong>${app.formLabel}</strong> has been submitted and requires your vote.
      </p>
      ${appSummary(app)}
      ${attachmentLinks(app)}
      <p style="color:#5a6478;font-size:13px;line-height:1.6;">
        Please log in to your portal to review the full application and cast your vote.
      </p>
      ${portalBtn(member.accessToken, 'Review & Vote →')}
      <p style="color:#b0b8c8;font-size:11px;">You will receive a daily reminder until you have voted or the application has been decided.</p>
    `);

    try {
      await sgMail.send({
        to: member.email,
        from: FROM,
        subject: `Vote Required: ${app.formLabel} — Lot ${app.lot}, ${app.building} [${app.ref}]`,
        html
      });
      await logEmail({ to: member.email, subject: `Vote Required: ${app.formLabel} [${app.ref}]`, type: 'vote_required', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
      console.log(`New app email sent to ${member.name}`);
    } catch (err) {
      console.error(`Failed to email ${member.name}:`, err.message);
    }
  }
}

// ─── 3. APPLICANT CONFIRMATION ───
async function sendApplicantConfirmation(app) {
  if (!app.submittedByEmail) return;
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${app.submittedByName || 'Resident'},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Your <strong>${app.formLabel}</strong> has been received and logged. Your reference number is:
    </p>
    <div style="background:#fffbf0;border:1px solid #f0dfa0;border-radius:8px;padding:14px;text-align:center;margin:16px 0;">
      <span style="font-size:22px;font-weight:700;color:#a07c20;letter-spacing:0.08em;">${app.ref}</span>
    </div>
    ${appSummary(app)}
    ${attachmentLinks(app)}
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Your application has been sent to the body corporate committee for consideration. You will be notified of the outcome by email. Please retain your reference number for your records.
    </p>
  `);

  await sgMail.send({
    to: app.submittedByEmail,
    from: FROM,
    subject: `Application received: ${app.formLabel} [${app.ref}]`,
    html
  });
  await logEmail({ to: app.submittedByEmail, subject: `Application received [${app.ref}]`, type: 'applicant_confirmation', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
}

// ─── 4. INFO REQUEST TO APPLICANT ───
async function sendInfoRequestToApplicant(app, questions, responseToken) {
  if (!app.submittedByEmail) return;

  const questionList = questions.map((q, i) =>
    `<div style="background:#f8f9fa;border-left:3px solid #c4a038;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;">
      <p style="font-size:11px;color:#9aa3b2;margin:0 0 4px;">${q.memberName} asks:</p>
      <p style="font-size:13px;color:#1a2333;margin:0;">${q.question}</p>
    </div>`
  ).join('');

  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${app.submittedByName || 'Resident'},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      The body corporate committee requires additional information before they can consider your <strong>${app.formLabel}</strong> [${app.ref}].
    </p>
    <div style="background:#fffbf0;border:1px solid #f0dfa0;border-radius:8px;padding:14px;margin:14px 0;">
      <p style="font-size:12px;font-weight:700;color:#7a5c10;margin:0 0 10px;">Questions from the committee:</p>
      ${questionList}
    </div>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Please click the button below to submit your response. You have <strong>14 days</strong> to respond before the application is marked as lapsed.
    </p>
    <div style="text-align:center;margin:20px 0;">
      <a href="${BASE_URL}/respond/${responseToken}" style="display:inline-block;background:#c4a038;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
        Submit My Response →
      </a>
    </div>
    <p style="color:#b0b8c8;font-size:11px;">This response link expires in 14 days.</p>
  `);

  await sgMail.send({
    to: app.submittedByEmail,
    from: FROM,
    subject: `Further information required — Your ${app.formLabel} [${app.ref}]`,
    html
  });
  await logEmail({ to: app.submittedByEmail, subject: `Further information required [${app.ref}]`, type: 'info_request', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
}

// ─── 5. INFO ADDENDUM TO APPLICANT ───
async function sendInfoAddendum(app, newQuestion) {
  if (!app.submittedByEmail) return;
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${app.submittedByName || 'Resident'},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      An additional question has been raised regarding your <strong>${app.formLabel}</strong> [${app.ref}].
    </p>
    <div style="background:#fffbf0;border:1px solid #f0dfa0;border-radius:8px;padding:14px;margin:14px 0;">
      <p style="font-size:11px;color:#9aa3b2;margin:0 0 4px;">${newQuestion.memberName} asks:</p>
      <p style="font-size:13px;color:#1a2333;margin:0;">${newQuestion.question}</p>
    </div>
    <p style="color:#5a6478;font-size:13px;">Please include your response to this additional question when you submit via the link previously sent to you.</p>
  `);

  await sgMail.send({
    to: app.submittedByEmail,
    from: FROM,
    subject: `Additional question — Your ${app.formLabel} [${app.ref}]`,
    html
  });
  await logEmail({ to: app.submittedByEmail, subject: `Additional question [${app.ref}]`, type: 'info_addendum', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
}

// ─── 6. APPLICANT RESPONDED — NOTIFY COMMITTEE ───
async function sendApplicantRespondedToCommittee(members, app) {
  for (let i = 0; i < members.length; i++) {
    if (i > 0) await delay(300);
    const member = members[i];
    const html = baseEmail(`
      <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
      <p style="color:#5a6478;font-size:13px;line-height:1.6;">
        The applicant has responded to the committee's information request regarding the <strong>${app.formLabel}</strong> for Lot ${app.lot} at ${app.building}.
      </p>
      ${appSummary(app)}
      <p style="color:#5a6478;font-size:13px;line-height:1.6;">
        Please log in to your portal to review the response and cast or update your vote.
      </p>
      ${portalBtn(member.accessToken, 'Review Response & Vote →')}
    `);
    try {
      await sgMail.send({
        to: member.email,
        from: FROM,
        subject: `Applicant responded — ${app.formLabel} Lot ${app.lot} [${app.ref}] — Please review`,
        html
      });
      await logEmail({ to: member.email, subject: `Applicant responded [${app.ref}]`, type: 'applicant_responded', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
    } catch (err) {
      console.error(`Failed to email ${member.name}:`, err.message);
    }
  }
}

// ─── 7. OUTCOME TO APPLICANT ───
async function sendOutcomeToApplicant(app) {
  if (!app.submittedByEmail) return;
  const approved = app.outcome === 'approved';
  const color = approved ? '#2d9e5c' : '#d84a30';
  const word = approved ? 'Approved ✓' : 'Rejected ✗';

  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${app.submittedByName || 'Resident'},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      The body corporate committee has reached a decision on your <strong>${app.formLabel}</strong>.
    </p>
    <div style="background:${approved ? '#f0faf4' : '#fff3f0'};border:1px solid ${approved ? '#a8dbb8' : '#fcd4cc'};border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
      <span style="font-size:24px;font-weight:700;color:${color};">${word}</span>
    </div>
    ${appSummary(app)}
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      ${approved
        ? 'Your application has been approved by the committee. Please ensure you comply with all relevant by-laws and conditions.'
        : 'Your application has not been approved by the committee. If you have questions about this decision, please contact your building manager.'
      }
    </p>
  `);

  await sgMail.send({
    to: app.submittedByEmail,
    from: FROM,
    subject: `Your application has been ${approved ? 'APPROVED ✓' : 'REJECTED ✗'} — ${app.formLabel} [${app.ref}]`,
    html
  });
  await logEmail({ to: app.submittedByEmail, subject: `Application ${approved ? 'APPROVED' : 'REJECTED'} [${app.ref}]`, type: 'outcome_applicant', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
}

// ─── 8. BUILDING MANAGER NOTIFICATIONS ───
async function notifyManager(subject, content) {
  const html = baseEmail(`
    <div style="background:#1a3a5c;border-radius:6px;padding:10px 14px;margin-bottom:16px;">
      <p style="color:#c4a038;font-size:11px;font-weight:700;margin:0;text-transform:uppercase;letter-spacing:0.08em;">Building Manager Update</p>
    </div>
    ${content}
  `);
  try {
    await sgMail.send({ to: MANAGER_EMAIL, from: FROM, subject, html });
    console.log('Manager notified:', subject);
  } catch (err) {
    console.error('Manager notification failed:', err.message);
  }
}

async function notifyManagerLogged(subject, content, app, type) {
  await notifyManager(subject, content);
  await logEmail({ to: MANAGER_EMAIL, subject, type: type || 'manager_notification', applicationId: app && app.applicationId, ref: app && app.ref, buildingKey: app && app.buildingKey });
}

async function notifyManagerNewSubmission(app) {
  const subject = `New submission: ${app.formLabel} — Lot ${app.lot}, ${app.building} [${app.ref}]`;
  await notifyManagerLogged(subject,
    `<p style="color:#5a6478;font-size:13px;">A new application has been submitted and sent to the committee for voting.</p>${appSummary(app)}`,
    app, 'new_submission'
  );
}

async function notifyManagerOutcome(app) {
  const outcome = app.outcome || app.status || 'decided';
  app = { ...app, outcome };
  const approved = outcome === 'approved';
  const votes = app.auditSnapshot && app.auditSnapshot.voteBreakdown
    ? app.auditSnapshot.voteBreakdown.map(v =>
        `<tr><td style="padding:3px 0;color:#5a6478;font-size:12px;">${v.memberName}</td><td style="font-weight:600;color:${v.vote === 'approve' ? '#2d9e5c' : v.vote === 'reject' ? '#d84a30' : '#c4a038'};font-size:12px;">${v.vote || 'Did not vote'}</td></tr>`
      ).join('')
    : '';

  const subject = `${approved ? 'APPROVED ✓' : 'REJECTED ✗'} — ${app.formLabel} Lot ${app.lot}, ${app.building} [${app.ref}]`;
  await notifyManagerLogged(subject,
    `
      <p style="color:#5a6478;font-size:13px;">A majority has been reached. The application has been <strong style="color:${approved ? '#2d9e5c' : '#d84a30'};">${outcome.toUpperCase()}</strong>.</p>
      ${appSummary(app)}
      ${votes ? `<div style="background:#f4f5f7;border-radius:8px;padding:12px;margin-top:12px;"><p style="font-size:11px;font-weight:700;color:#1a2333;margin:0 0 8px;">Vote breakdown:</p><table style="width:100%;">${votes}</table></div>` : ''}
    `,
    app, 'outcome_manager'
  );
}

async function notifyManagerVoteChanged(app, memberName, oldVote, newVote) {
  const subject = `Vote changed — ${memberName}: ${oldVote} → ${newVote} — ${app.formLabel} Lot ${app.lot} [${app.ref}]`;
  await notifyManagerLogged(subject,
    `<p style="color:#5a6478;font-size:13px;"><strong>${memberName}</strong> changed their vote from <strong>${oldVote}</strong> to <strong>${newVote}</strong>.</p>${appSummary(app)}`,
    app, 'vote_changed'
  );
}

async function notifyManagerStuck(app) {
  const votes = app.votes ? Object.values(app.votes).filter(v => v.vote).length : 0;
  const subject = `⚠️ No majority after 7 days — ${app.formLabel} Lot ${app.lot}, ${app.building} [${app.ref}]`;
  await notifyManagerLogged(subject,
    `
      <p style="color:#5a6478;font-size:13px;">This application has been open for 7 days without a majority. Current votes: <strong>${votes}</strong> of <strong>${app.committeeSnapshot.requiredVotes}</strong> required.</p>
      ${appSummary(app)}
      <p style="color:#5a6478;font-size:13px;">The application will automatically lapse after 14 days if no majority is reached.</p>
    `,
    app, 'stuck_alert'
  );
}

async function notifyManagerLapsed(app) {
  const subject = `LAPSED — ${app.formLabel} Lot ${app.lot}, ${app.building} [${app.ref}] — 14 days no majority`;
  await notifyManagerLogged(subject,
    `<p style="color:#5a6478;font-size:13px;">This application has been automatically lapsed after 14 days without a majority. The applicant has been notified.</p>${appSummary(app)}`,
    app, 'lapsed_manager'
  );
}

// ─── 9. DAILY REMINDER TO NON-VOTERS ───
async function sendDailyReminder(member, app, dayNumber) {
  const votes = app.votes ? Object.values(app.votes).filter(v => v.vote && v.vote !== 'info').length : 0;
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      This is a reminder that your vote is required on the following application.
    </p>
    <div style="background:#fff3f0;border:1px solid #fcd4cc;border-radius:8px;padding:10px 14px;margin:10px 0;">
      <p style="font-size:12px;color:#d84a30;margin:0;font-weight:700;">Day ${dayNumber} — Vote still required</p>
      <p style="font-size:11px;color:#7a5c10;margin:4px 0 0;">${votes} of ${app.committeeSnapshot.requiredVotes} required votes cast so far.</p>
    </div>
    ${appSummary(app)}
    ${portalBtn(member.accessToken, 'Cast My Vote Now →')}
    <p style="color:#b0b8c8;font-size:11px;">You will continue to receive daily reminders until you vote or the application is decided.</p>
  `);

  try {
    await sgMail.send({
      to: member.email,
      from: FROM,
      subject: `Reminder [Day ${dayNumber}]: Vote required — ${app.formLabel} Lot ${app.lot} [${app.ref}]`,
      html
    });
    await logEmail({ to: member.email, subject: `Reminder Day ${dayNumber} [${app.ref}]`, type: 'daily_reminder', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
    console.log(`Day ${dayNumber} reminder sent to ${member.name}`);
  } catch (err) {
    console.error(`Reminder failed for ${member.name}:`, err.message);
  }
}

// ─── 10. TOKEN REGENERATED ───
async function sendTokenRegenerated(member, building) {
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Your My Building Portal access link has been regenerated. Your previous link is no longer active.
    </p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Please use the new link below and update your bookmark.
    </p>
    ${portalBtn(member.accessToken, 'Open My New Portal Link →')}
    <div style="background:#fff3f0;border:1px solid #fcd4cc;border-radius:8px;padding:12px 14px;margin:14px 0;">
      <p style="font-size:12px;color:#d84a30;margin:0;font-weight:600;">⚠️ Keep this link private.</p>
    </div>
  `);

  await sgMail.send({
    to: member.email,
    from: FROM,
    subject: `Your portal access link has been updated — ${building.name}`,
    html
  });
  await logEmail({ to: member.email, subject: `Portal link regenerated — ${building.name}`, type: 'token_regenerated', buildingKey: member.buildingKey });
}

// ─── 11. LAPSED NOTIFICATION TO APPLICANT ───
async function sendLapsedToApplicant(app) {
  if (!app.submittedByEmail) return;
  const html = baseEmail(`
    <p style="color:#1a2333;font-size:14px;">Dear ${app.submittedByName || 'Resident'},</p>
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      Unfortunately your <strong>${app.formLabel}</strong> [${app.ref}] has lapsed as the committee was unable to reach a majority decision within the required timeframe.
    </p>
    ${appSummary(app)}
    <p style="color:#5a6478;font-size:13px;line-height:1.6;">
      If you wish to resubmit your application, please do so through My Building Portal. If you have questions, please contact your building manager.
    </p>
  `);

  await sgMail.send({
    to: app.submittedByEmail,
    from: FROM,
    subject: `Application lapsed — ${app.formLabel} [${app.ref}]`,
    html
  });
  await logEmail({ to: app.submittedByEmail, subject: `Application lapsed [${app.ref}]`, type: 'lapsed_applicant', applicationId: app.applicationId, ref: app.ref, buildingKey: app.buildingKey });
}

module.exports = {
  sendWelcomeEmail,
  sendNewApplicationToCommittee,
  sendApplicantConfirmation,
  sendInfoRequestToApplicant,
  sendInfoAddendum,
  sendApplicantRespondedToCommittee,
  sendOutcomeToApplicant,
  notifyManagerNewSubmission,
  notifyManagerOutcome,
  notifyManagerVoteChanged,
  notifyManagerStuck,
  notifyManagerLapsed,
  sendDailyReminder,
  sendTokenRegenerated,
  sendLapsedToApplicant
};