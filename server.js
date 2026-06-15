require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── FIREBASE ───
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});
const db = admin.database();

// ─── SENDGRID ───
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ─── MAJORITY RULES ───
function requiredVotes(committeeSize) {
  const rules = { 3: 2, 4: 3, 5: 3, 6: 4, 7: 4 };
  return rules[committeeSize] || Math.ceil(committeeSize / 2);
}

// ─── COMMITTEE DATA (fake names/emails for testing) ───
const COMMITTEES = {
  NT: {
    name: 'Newstead Towers',
    size: 5,
    members: [
      { id: 'nt1', name: 'Sarah Mitchell', email: 'sarah.mitchell.nt@mailinator.com' },
      { id: 'nt2', name: 'James Kowalski', email: 'james.kowalski.nt@mailinator.com' },
      { id: 'nt3', name: 'Priya Sharma', email: 'priya.sharma.nt@mailinator.com' },
      { id: 'nt4', name: 'David Chen', email: 'david.chen.nt@mailinator.com' },
      { id: 'nt5', name: 'Lisa Okafor', email: 'lisa.okafor.nt@mailinator.com' }
    ]
  },
  FT: {
    name: 'Festival Towers',
    size: 5,
    members: [
      { id: 'ft1', name: 'Michael Torres', email: 'roderickharding@hotmail.com' },
      { id: 'ft2', name: 'Angela Nguyen', email: 'roderickharding@hotmail.com' },
      { id: 'ft3', name: 'Robert Singh', email: 'roderickharding@hotmail.com' },
      { id: 'ft4', name: 'Claire Dubois', email: 'roderickharding@hotmail.com' },
      { id: 'ft5', name: 'Tony Papadopoulos', email: 'roderickharding@hotmail.com' }
    ]
  },
  NC: {
    name: 'Newstead Central',
    size: 7,
    members: [
      { id: 'nc1', name: 'Helen Park', email: 'helen.park.nc@mailinator.com' },
      { id: 'nc2', name: 'Steve Lawson', email: 'steve.lawson.nc@mailinator.com' },
      { id: 'nc3', name: 'Maria Costa', email: 'maria.costa.nc@mailinator.com' },
      { id: 'nc4', name: 'Ben Fitzgerald', email: 'ben.fitz.nc@mailinator.com' },
      { id: 'nc5', name: 'Amy Zhou', email: 'amy.zhou.nc@mailinator.com' },
      { id: 'nc6', name: 'Paul Henderson', email: 'paul.hendo.nc@mailinator.com' },
      { id: 'nc7', name: 'Susan Baker', email: 'susan.baker.nc@mailinator.com' }
    ]
  },
  SP: {
    name: 'The Spire',
    size: 3,
    members: [
      { id: 'sp1', name: 'Nathan Reed', email: 'nathan.reed.sp@mailinator.com' },
      { id: 'sp2', name: 'Karen Walsh', email: 'karen.walsh.sp@mailinator.com' },
      { id: 'sp3', name: 'Frank Moretti', email: 'frank.moretti.sp@mailinator.com' }
    ]
  },
  NS: {
    name: 'Newstead Series',
    size: 4,
    members: [
      { id: 'ns1', name: 'Olivia Grant', email: 'olivia.grant.ns@mailinator.com' },
      { id: 'ns2', name: 'Chris Yamamoto', email: 'chris.yama.ns@mailinator.com' },
      { id: 'ns3', name: 'Debra Nkosi', email: 'debra.nkosi.ns@mailinator.com' },
      { id: 'ns4', name: 'Mark Sullivan', email: 'mark.sull.ns@mailinator.com' }
    ]
  },
  BA: {
    name: 'Broadway on Ann',
    size: 5,
    members: [
      { id: 'ba1', name: 'Rachel Tran', email: 'rachel.tran.ba@mailinator.com' },
      { id: 'ba2', name: 'Ian Fletcher', email: 'ian.fletcher.ba@mailinator.com' },
      { id: 'ba3', name: 'Monica Patel', email: 'monica.patel.ba@mailinator.com' },
      { id: 'ba4', name: 'Gary Whitfield', email: 'gary.white.ba@mailinator.com' },
      { id: 'ba5', name: 'Julia Andersen', email: 'julia.and.ba@mailinator.com' }
    ]
  }
};

// ─── SUBMIT FORM ───
app.post('/api/submit', async (req, res) => {
  try {
    const { building, buildingKey, lot, formId, formLabel, formData } = req.body;

    const ref = 'MBP-' + Date.now().toString().slice(-6);
    const submissionId = uuidv4();
    const timestamp = new Date().toISOString();

    const committee = COMMITTEES[buildingKey];
    if (!committee) return res.status(400).json({ error: 'Unknown building' });

    // Determine if this form type needs committee voting
    const votingForms = ['pet', 'lot-improve', 'motion', 'payment-plan', 'discount', 'bylaws', 'refund', 'company-nominee'];
    const needsVote = votingForms.includes(formId);

    // Build vote tokens for each committee member
    const votes = {};
    const tokens = {};
    committee.members.forEach(member => {
      const token = uuidv4();
      tokens[token] = member.id;
      votes[member.id] = {
        name: member.name,
        email: member.email,
        vote: null,
        votedAt: null,
        token: token,
        infoRequest: null
      };
    });

    // Save submission to Firebase
    const submission = {
      submissionId,
      ref,
      building,
      buildingKey,
      lot,
      formId,
      formLabel,
      formData,
      timestamp,
      status: needsVote ? 'pending_vote' : 'received',
      votes: needsVote ? votes : null,
      tokens: needsVote ? tokens : null,
      outcome: null,
      outcomeAt: null,
      requiredVotes: needsVote ? requiredVotes(committee.size) : null,
      committeeSize: committee.size
    };

    await db.ref(`submissions/${submissionId}`).set(submission);

    // Also store tokens lookup for fast retrieval
    if (needsVote) {
      for (const [token, memberId] of Object.entries(tokens)) {
        await db.ref(`tokens/${token}`).set({ submissionId, memberId });
      }
    }

    // Send vote emails to committee members
    if (needsVote) {
      await sendVoteEmails(submission, committee);
    }

    // Send confirmation to applicant
    if (formData.email) {
      await sendApplicantConfirmation(formData.email, formData.name || 'Resident', submission);
    }

    res.json({ success: true, ref, submissionId });

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── VOTE HANDLER ───
app.get('/vote', async (req, res) => {
  const { token, decision } = req.query;

  if (!token || !decision) {
    return res.send(votePage('Invalid link.', 'error'));
  }

  try {
    // Look up token
    const tokenSnap = await db.ref(`tokens/${token}`).once('value');
    if (!tokenSnap.exists()) {
      return res.send(votePage('This link is invalid or has expired.', 'error'));
    }

    const { submissionId, memberId } = tokenSnap.val();

    // Get submission
    const subSnap = await db.ref(`submissions/${submissionId}`).once('value');
    if (!subSnap.exists()) {
      return res.send(votePage('Submission not found.', 'error'));
    }

    const submission = subSnap.val();

    // Check already voted
    if (submission.votes[memberId].vote !== null) {
      return res.send(votePage('You have already voted on this application.', 'already'));
    }

    // Check submission still open
    if (submission.status !== 'pending_vote') {
      return res.send(votePage('This application has already been decided.', 'closed'));
    }

    // If requesting more info, show form
    if (decision === 'info') {
      return res.send(infoRequestPage(token, submission));
    }

    // Record vote
    const validVotes = ['approve', 'reject'];
    if (!validVotes.includes(decision)) {
      return res.send(votePage('Invalid vote.', 'error'));
    }

    const votedAt = new Date().toISOString();
    await db.ref(`submissions/${submissionId}/votes/${memberId}`).update({
      vote: decision,
      votedAt
    });

    // Delete token so it can't be used again
    await db.ref(`tokens/${token}`).remove();

    // Check if majority reached
    await checkMajority(submissionId);

    const memberName = submission.votes[memberId].name;
    const voteLabel = decision === 'approve' ? 'Approved' : 'Rejected';
    return res.send(votePage(`Thank you ${memberName}. Your vote of <strong>${voteLabel}</strong> has been recorded.`, 'success'));

  } catch (err) {
    console.error('Vote error:', err);
    res.send(votePage('An error occurred. Please try again.', 'error'));
  }
});

// ─── INFO REQUEST HANDLER ───
app.post('/vote/info', async (req, res) => {
  const { token, infoRequest } = req.body;

  try {
    const tokenSnap = await db.ref(`tokens/${token}`).once('value');
    if (!tokenSnap.exists()) return res.send(votePage('Invalid link.', 'error'));

    const { submissionId, memberId } = tokenSnap.val();
    const subSnap = await db.ref(`submissions/${submissionId}`).once('value');
    const submission = subSnap.val();

    if (submission.votes[memberId].vote !== null) {
      return res.send(votePage('You have already responded to this application.', 'already'));
    }

    // Record info request vote
    await db.ref(`submissions/${submissionId}/votes/${memberId}`).update({
      vote: 'info',
      votedAt: new Date().toISOString(),
      infoRequest
    });

    // Update submission status
    await db.ref(`submissions/${submissionId}`).update({
      status: 'awaiting_info',
      infoRequest,
      infoRequestedAt: new Date().toISOString(),
      infoRequestedBy: submission.votes[memberId].name
    });

    // Email applicant
    if (submission.formData && submission.formData.email) {
      await sendInfoRequestEmail(submission, infoRequest, submission.votes[memberId].name);
    }

    await db.ref(`tokens/${token}`).remove();

    return res.send(votePage(`Thank you. Your information request has been sent to the applicant.`, 'success'));

  } catch (err) {
    console.error('Info request error:', err);
    res.send(votePage('An error occurred.', 'error'));
  }
});

// ─── CHECK MAJORITY ───
async function checkMajority(submissionId) {
  let finalOutcome = null;
  let finalSubmission = null;

  // Transaction ensures only ONE caller ever writes the terminal status.
  // If two votes arrive simultaneously, only the first transaction wins —
  // the second sees the already-updated status and aborts.
  await db.ref(`submissions/${submissionId}`).transaction((submission) => {
    if (!submission) return; // abort if node doesn't exist
    if (submission.status !== 'pending_vote') return; // abort — already decided

    const votes = Object.values(submission.votes || {});
    const approvals = votes.filter(v => v.vote === 'approve').length;
    const rejections = votes.filter(v => v.vote === 'reject').length;
    const required = submission.requiredVotes;

    if (approvals >= required) {
      finalOutcome = 'approved';
      finalSubmission = submission;
      submission.status = 'approved';
      submission.outcome = 'approved';
      submission.outcomeAt = new Date().toISOString();
      return submission;
    } else if (rejections >= required) {
      finalOutcome = 'rejected';
      finalSubmission = submission;
      submission.status = 'rejected';
      submission.outcome = 'rejected';
      submission.outcomeAt = new Date().toISOString();
      return submission;
    }

    return; // no majority yet — abort transaction, change nothing
  });

  // Send emails ONLY if this transaction call was the one that finalized
  if (finalOutcome && finalSubmission) {
    await sendOutcomeEmail(finalSubmission, finalOutcome);
  }
}

// ─── SEND VOTE EMAILS ───
async function sendVoteEmails(submission, committee) {
  const baseUrl = process.env.BASE_URL;

  for (const member of committee.members) {
    const memberVote = submission.votes[member.id];
    const token = memberVote.token;

    const approveUrl = `${baseUrl}/vote?token=${token}&decision=approve`;
    const rejectUrl = `${baseUrl}/vote?token=${token}&decision=reject`;
    const infoUrl = `${baseUrl}/vote?token=${token}&decision=info`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
        <div style="background:#1a3a5c;padding:20px 24px;border-radius:8px 8px 0 0;">
          <h1 style="color:#fff;font-size:20px;margin:0;">My Building Portal</h1>
          <p style="color:#c4a038;margin:4px 0 0;font-size:13px;">Committee Vote Required</p>
        </div>
        <div style="padding:24px;border:1px solid #e2e5ea;border-top:none;border-radius:0 0 8px 8px;">
          <p style="color:#1a2333;font-size:14px;">Dear ${member.name},</p>
          <p style="color:#5a6478;font-size:13px;line-height:1.6;">A new <strong>${submission.formLabel}</strong> has been submitted and requires your vote.</p>

          <div style="background:#f4f5f7;border-radius:8px;padding:16px;margin:16px 0;">
            <table style="width:100%;font-size:13px;color:#1a2333;">
              <tr><td style="color:#9aa3b2;padding:3px 0;width:140px;">Building</td><td><strong>${submission.building}</strong></td></tr>
              <tr><td style="color:#9aa3b2;padding:3px 0;">Lot</td><td><strong>${submission.lot}</strong></td></tr>
              <tr><td style="color:#9aa3b2;padding:3px 0;">Form type</td><td><strong>${submission.formLabel}</strong></td></tr>
              <tr><td style="color:#9aa3b2;padding:3px 0;">Reference</td><td><strong>${submission.ref}</strong></td></tr>
              <tr><td style="color:#9aa3b2;padding:3px 0;">Submitted</td><td><strong>${new Date(submission.timestamp).toLocaleString('en-AU')}</strong></td></tr>
              <tr><td style="color:#9aa3b2;padding:3px 0;">Votes required</td><td><strong>${submission.requiredVotes} of ${submission.committeeSize}</strong></td></tr>
            </table>
          </div>

          ${submission.formData && submission.formData.name ? `
          <div style="background:#e8f0fb;border-radius:8px;padding:12px 16px;margin:0 0 16px;">
            <p style="margin:0;font-size:13px;color:#1a5a9e;"><strong>Applicant:</strong> ${submission.formData.name}</p>
            ${submission.formData.petName ? `<p style="margin:4px 0 0;font-size:13px;color:#1a5a9e;"><strong>Pet:</strong> ${submission.formData.petName} (${submission.formData.breed || ''})</p>` : ''}
          </div>` : ''}

          <p style="color:#5a6478;font-size:13px;margin-bottom:20px;">Please cast your vote by clicking one of the buttons below. Each button can only be used once.</p>

          <div style="text-align:center;margin:24px 0;">
            <a href="${approveUrl}" style="display:inline-block;background:#2d9e5c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin:0 6px;">✓ Approve</a>
            <a href="${rejectUrl}" style="display:inline-block;background:#d84a30;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin:0 6px;">✗ Reject</a>
            <a href="${infoUrl}" style="display:inline-block;background:#c4a038;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin:0 6px;">? More Info</a>
          </div>

          <p style="color:#b0b8c8;font-size:11px;text-align:center;margin-top:24px;">This email was sent by My Building Portal. Do not forward this email — your vote links are unique to you.</p>
        </div>
      </div>
    `;

    await sgMail.send({
      to: member.email,
      from: { email: process.env.SENDGRID_FROM, name: 'My Building Portal' },
      subject: `Vote Required: ${submission.formLabel} — Lot ${submission.lot}, ${submission.building} [${submission.ref}]`,
      html
    });
  }
}

// ─── SEND APPLICANT CONFIRMATION ───
async function sendApplicantConfirmation(email, name, submission) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a3a5c;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">My Building Portal</h1>
        <p style="color:#c4a038;margin:4px 0 0;font-size:13px;">Submission Received</p>
      </div>
      <div style="padding:24px;border:1px solid #e2e5ea;border-top:none;border-radius:0 0 8px 8px;">
        <p style="color:#1a2333;">Dear ${name},</p>
        <p style="color:#5a6478;font-size:13px;line-height:1.6;">Your <strong>${submission.formLabel}</strong> has been received and logged. Your reference number is:</p>
        <div style="background:#fffbf0;border:1px solid #f0dfa0;border-radius:8px;padding:14px;text-align:center;margin:16px 0;">
          <span style="font-size:20px;font-weight:700;color:#a07c20;letter-spacing:0.08em;">${submission.ref}</span>
        </div>
        <div style="background:#f4f5f7;border-radius:8px;padding:16px;margin:16px 0;">
          <table style="width:100%;font-size:13px;color:#1a2333;">
            <tr><td style="color:#9aa3b2;padding:3px 0;width:120px;">Building</td><td><strong>${submission.building}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Lot</td><td><strong>${submission.lot}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Form</td><td><strong>${submission.formLabel}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Submitted</td><td><strong>${new Date(submission.timestamp).toLocaleString('en-AU')}</strong></td></tr>
          </table>
        </div>
        <p style="color:#5a6478;font-size:13px;line-height:1.6;">Your application has been sent to the body corporate committee for consideration. You will be notified of the outcome by email. Please keep your reference number for your records.</p>
        <p style="color:#b0b8c8;font-size:11px;margin-top:24px;">My Building Portal · Brisbane QLD · All submissions are retained for 7 years in accordance with Queensland body corporate record-keeping requirements.</p>
      </div>
    </div>
  `;

  await sgMail.send({
    to: email,
    from: { email: process.env.SENDGRID_FROM, name: 'My Building Portal' },
    subject: `Your ${submission.formLabel} has been received [${submission.ref}]`,
    html
  });
}

// ─── SEND OUTCOME EMAIL ───
async function sendOutcomeEmail(submission, outcome) {
  if (!submission.formData || !submission.formData.email) return;

  const approved = outcome === 'approved';
  const color = approved ? '#2d9e5c' : '#d84a30';
  const word = approved ? 'Approved' : 'Rejected';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a3a5c;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">My Building Portal</h1>
        <p style="color:#c4a038;margin:4px 0 0;font-size:13px;">Application Outcome</p>
      </div>
      <div style="padding:24px;border:1px solid #e2e5ea;border-top:none;border-radius:0 0 8px 8px;">
        <p style="color:#1a2333;">Dear ${submission.formData.name || 'Resident'},</p>
        <p style="color:#5a6478;font-size:13px;line-height:1.6;">The body corporate committee has reached a decision on your <strong>${submission.formLabel}</strong>.</p>
        <div style="background:${approved ? '#f0faf4' : '#fff3f0'};border:1px solid ${approved ? '#a8dbb8' : '#fcd4cc'};border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
          <span style="font-size:22px;font-weight:700;color:${color};">${approved ? '✓' : '✗'} ${word}</span>
        </div>
        <div style="background:#f4f5f7;border-radius:8px;padding:16px;margin:16px 0;">
          <table style="width:100%;font-size:13px;color:#1a2333;">
            <tr><td style="color:#9aa3b2;padding:3px 0;width:120px;">Reference</td><td><strong>${submission.ref}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Building</td><td><strong>${submission.building}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Lot</td><td><strong>${submission.lot}</strong></td></tr>
            <tr><td style="color:#9aa3b2;padding:3px 0;">Form</td><td><strong>${submission.formLabel}</strong></td></tr>
          </table>
        </div>
        ${approved
          ? '<p style="color:#5a6478;font-size:13px;">Your application has been approved by the committee. Please ensure you comply with all relevant by-laws and conditions.</p>'
          : '<p style="color:#5a6478;font-size:13px;">Your application has not been approved by the committee. If you have questions about this decision, please contact your building manager.</p>'
        }
        <p style="color:#b0b8c8;font-size:11px;margin-top:24px;">My Building Portal · Brisbane QLD</p>
      </div>
    </div>
  `;

  await sgMail.send({
    to: submission.formData.email,
    from: { email: process.env.SENDGRID_FROM, name: 'My Building Portal' },
    subject: `Application ${word}: ${submission.formLabel} [${submission.ref}]`,
    html
  });
}

// ─── SEND INFO REQUEST EMAIL TO APPLICANT ───
async function sendInfoRequestEmail(submission, infoRequest, requestedBy) {
  if (!submission.formData || !submission.formData.email) return;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a3a5c;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">My Building Portal</h1>
        <p style="color:#c4a038;margin:4px 0 0;font-size:13px;">Further Information Required</p>
      </div>
      <div style="padding:24px;border:1px solid #e2e5ea;border-top:none;border-radius:0 0 8px 8px;">
        <p style="color:#1a2333;">Dear ${submission.formData.name || 'Resident'},</p>
        <p style="color:#5a6478;font-size:13px;line-height:1.6;">The body corporate committee requires additional information before they can consider your <strong>${submission.formLabel}</strong> [${submission.ref}].</p>
        <div style="background:#fffbf0;border:1px solid #f0dfa0;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;font-size:13px;color:#7a5c10;font-weight:600;">Information requested:</p>
          <p style="margin:8px 0 0;font-size:13px;color:#5a6478;">${infoRequest}</p>
        </div>
        <p style="color:#5a6478;font-size:13px;">Please reply to this email with the requested information. Once received, your application will be resubmitted to the committee for consideration.</p>
        <p style="color:#b0b8c8;font-size:11px;margin-top:24px;">My Building Portal · Brisbane QLD</p>
      </div>
    </div>
  `;

  await sgMail.send({
    to: submission.formData.email,
    from: { email: process.env.SENDGRID_FROM, name: 'My Building Portal' },
    replyTo: process.env.SENDGRID_FROM,
    subject: `Further Information Required: ${submission.formLabel} [${submission.ref}]`,
    html
  });
}

// ─── VOTE PAGE HTML ───
function votePage(message, type) {
  const colors = { success: '#2d9e5c', error: '#d84a30', already: '#c4a038', closed: '#1a5a9e' };
  const color = colors[type] || '#1a5a9e';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>My Building Portal</title>
  <style>body{font-family:Arial,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .card{background:#fff;border-radius:12px;padding:32px 24px;max-width:420px;width:90%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08);}
  .icon{font-size:40px;margin-bottom:16px;}.h{font-size:20px;font-weight:700;color:#1a2333;margin-bottom:10px;}
  .msg{font-size:14px;color:#5a6478;line-height:1.6;}</style></head>
  <body><div class="card">
  <div class="icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</div>
  <div class="h" style="color:${color};">My Building Portal</div>
  <div class="msg">${message}</div>
  </div></body></html>`;
}

// ─── INFO REQUEST PAGE ───
function infoRequestPage(token, submission) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Request More Information</title>
  <style>body{font-family:Arial,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .card{background:#fff;border-radius:12px;padding:28px 24px;max-width:480px;width:90%;box-shadow:0 2px 12px rgba(0,0,0,0.08);}
  h2{font-size:18px;color:#1a2333;margin:0 0 8px;}p{font-size:13px;color:#5a6478;line-height:1.6;}
  .meta{background:#f4f5f7;border-radius:8px;padding:12px;margin:12px 0;font-size:12px;color:#1a2333;}
  textarea{width:100%;border:1px solid #e2e5ea;border-radius:8px;padding:10px;font-family:Arial,sans-serif;font-size:13px;min-height:100px;outline:none;resize:vertical;margin:8px 0;}
  textarea:focus{border-color:#c4a038;}
  button{width:100%;padding:13px;background:#c4a038;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;}</style></head>
  <body><div class="card">
  <h2>Request More Information</h2>
  <div class="meta">
    <strong>${submission.building}</strong> · Lot ${submission.lot}<br/>
    ${submission.formLabel} · ${submission.ref}
  </div>
  <p>Specify exactly what information you need from the applicant before you can vote.</p>
  <form method="POST" action="/vote/info">
    <input type="hidden" name="token" value="${token}"/>
    <textarea name="infoRequest" placeholder="e.g. Please provide vaccination certificate and council registration for the animal..." required></textarea>
    <button type="submit">Send Information Request</button>
  </form>
  </div></body></html>`;
}

// ─── ADMIN: GET ALL SUBMISSIONS ───
app.get('/api/admin/submissions', async (req, res) => {
  try {
    const snap = await db.ref('submissions').once('value');
    const data = snap.val() || {};
    // Return without tokens for security
    const safe = Object.values(data).map(s => {
      const { tokens, ...rest } = s;
      return rest;
    });
    // Sort newest first
    safe.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SERVE FRONTEND ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`My Building Portal running on port ${PORT}`));