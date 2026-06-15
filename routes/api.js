const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { BUILDINGS, MAJORITY } = require('../config/committees');
const email = require('../services/email');
const voting = require('../services/voting');
const { upload, uploadFilesToStorage } = require('../services/uploads');
const { v4: uuidv4 } = require('uuid');

// ─── FORMS THAT NEED COMMITTEE VOTE ───
const VOTING_FORMS = ['pet', 'lot-improve', 'motion', 'payment-plan', 'discount', 'bylaws', 'refund', 'company-nominee'];

// ─── SUBMIT APPLICATION — multipart/form-data ───
// Frontend sends FormData: JSON fields as text, files as file fields
router.post('/submit', upload.any(), async (req, res) => {
  try {
    // FormData sends JSON fields as strings — parse formData back out
    const { building, buildingKey, lot, formId, formLabel } = req.body;
    const formData = req.body.formData ? JSON.parse(req.body.formData) : {};

    console.log('=== SUBMIT ===', { building, buildingKey, lot, formId, formLabel, email: formData.email, files: req.files && req.files.length });

    const building_config = BUILDINGS[buildingKey];
    if (!building_config) return res.status(400).json({ error: 'Unknown building' });

    // Get active committee members for this building
    const membersSnap = await db.ref('committee_members')
      .orderByChild('buildingKey').equalTo(buildingKey).once('value');

    const allMembers = membersSnap.val() ? Object.values(membersSnap.val()).filter(m => m.active) : [];
    if (allMembers.length === 0) return res.status(400).json({ error: 'No committee members found' });

    const committeeSize = allMembers.length;
    const requiredVotes = MAJORITY[committeeSize] || Math.floor(committeeSize / 2) + 1;
    const needsVote = VOTING_FORMS.includes(formId);

    const applicationId = uuidv4();
    const ref = 'MBP-' + Date.now().toString().slice(-6);
    const now = new Date().toISOString();

    // ─── UPLOAD FILES TO FIREBASE STORAGE ───
    let attachments = [];
    if (req.files && req.files.length > 0) {
      try {
        attachments = await uploadFilesToStorage(req.files, applicationId);
        console.log(`Uploaded ${attachments.length} files for ${applicationId}`);
      } catch (uploadErr) {
        console.error('File upload failed:', uploadErr.message);
        // Don't block submission if upload fails — store empty, log it
      }
    }

    // Build votes object — all null initially
    const votes = {};
    allMembers.forEach(m => {
      votes[m.memberId] = {
        memberName: m.name,
        vote: null,
        votedAt: null,
        changedFrom: null,
        changedAt: null
      };
    });

    // Freeze committee snapshot
    const committeeSnapshot = {
      totalEligible: committeeSize,
      requiredVotes,
      address: building_config.address,
      members: allMembers.map(m => ({ id: m.memberId, name: m.name, email: m.email }))
    };

    const application = {
      applicationId,
      ref,
      building,
      buildingKey,
      lot,
      formId,
      formLabel,
      formData: formData || {},
      attachments: attachments.length > 0 ? attachments : null,
      submittedAt: now,
      submittedByName: formData.name || 'Unknown',
      submittedByEmail: formData.email || null,
      status: needsVote ? 'pending_vote' : 'received',
      lastUpdatedAt: now,
      committeeSnapshot,
      votes: needsVote ? votes : null,
      outcome: null,
      outcomeAt: null,
      managerStuckNotified: false,
      pdfUrl: null,
      infoThread: null,
      pending_questions: null,
      activeResponseToken: null,
      auditSnapshot: null
    };

    await db.ref(`applications/${applicationId}`).set(application);

    // Respond immediately
    res.json({ success: true, ref, applicationId });

    // Build membersWithTokens for committee emails
    const membersWithTokens = allMembers.map(m => ({
      id: m.memberId,
      name: m.name,
      email: m.email,
      accessToken: m.accessToken
    }));

    // Fire all emails in background
    const emailPromises = [
      email.sendApplicantConfirmation(application),
      email.notifyManagerNewSubmission(application)
    ];
    if (needsVote) {
      emailPromises.push(email.sendNewApplicationToCommittee(membersWithTokens, application));
    }
    Promise.all(emailPromises).catch(err => console.error('Background email error:', err.message));

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PORTAL — GET MEMBER DATA ───
router.get('/portal/:accessToken', async (req, res) => {
  try {
    const { accessToken } = req.params;

    const membersSnap = await db.ref('committee_members')
      .orderByChild('accessToken').equalTo(accessToken).once('value');

    if (!membersSnap.exists()) {
      return res.status(404).json({ error: 'Invalid or expired portal link' });
    }

    const memberData = Object.values(membersSnap.val())[0];
    if (!memberData.active) {
      return res.status(403).json({ error: 'This portal link has been deactivated' });
    }

    console.log('Portal query for buildingKey:', memberData.buildingKey);
    const appsSnap = await db.ref('applications')
      .orderByChild('buildingKey').equalTo(memberData.buildingKey).once('value');

    const allApps = appsSnap.val() ? Object.values(appsSnap.val()) : [];
    console.log('Applications found:', allApps.length, allApps.map(a => ({ref: a.ref, status: a.status, buildingKey: a.buildingKey})));

    const activeApps = allApps
      .filter(a => ['pending_vote', 'awaiting_info'].includes(a.status))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    const closedApps = allApps
      .filter(a => ['approved', 'rejected', 'lapsed', 'received'].includes(a.status))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .slice(0, 20);

    res.json({
      member: {
        id: memberData.memberId,
        name: memberData.name,
        building: memberData.buildingName,
        buildingKey: memberData.buildingKey
      },
      activeApplications: activeApps,
      closedApplications: closedApps
    });

  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── CAST VOTE ───
router.post('/vote', async (req, res) => {
  try {
    const { accessToken, applicationId, voteType } = req.body;

    const membersSnap = await db.ref('committee_members')
      .orderByChild('accessToken').equalTo(accessToken).once('value');

    if (!membersSnap.exists()) return res.status(403).json({ error: 'Invalid portal link' });

    const memberData = Object.values(membersSnap.val())[0];
    if (!memberData.active) return res.status(403).json({ error: 'Portal link deactivated' });

    const appSnap = await db.ref(`applications/${applicationId}`).once('value');
    if (!appSnap.exists()) return res.status(404).json({ error: 'Application not found' });

    const app = appSnap.val();
    const isMember = app.committeeSnapshot.members.some(m => m.id === memberData.memberId);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this committee' });

    if (voteType === 'info') {
      return res.status(400).json({ error: 'Use /api/info-request for more info requests' });
    }

    const result = await voting.castVote(applicationId, memberData.memberId, voteType);
    res.json(result);

  } catch (err) {
    if (err.message === 'APPLICATION_LOCKED') {
      return res.status(400).json({ error: 'This application has already been decided' });
    }
    console.error('Vote error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SUBMIT INFO REQUEST ───
router.post('/info-request', async (req, res) => {
  try {
    const { accessToken, applicationId, question } = req.body;

    const membersSnap = await db.ref('committee_members')
      .orderByChild('accessToken').equalTo(accessToken).once('value');

    if (!membersSnap.exists()) return res.status(403).json({ error: 'Invalid portal link' });

    const memberData = Object.values(membersSnap.val())[0];

    const result = await voting.submitInfoRequest(
      applicationId,
      memberData.memberId,
      memberData.name,
      question
    );

    res.json(result);

  } catch (err) {
    console.error('Info request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── APPLICANT RESPONSE PAGE DATA ───
router.get('/respond/:token', async (req, res) => {
  try {
    const tokenSnap = await db.ref(`response_tokens/${req.params.token}`).once('value');
    if (!tokenSnap.exists()) return res.status(404).json({ error: 'Invalid or expired link' });

    const tokenData = tokenSnap.val();
    if (new Date(tokenData.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'This response link has expired' });
    }

    const appSnap = await db.ref(`applications/${tokenData.applicationId}`).once('value');
    const app = appSnap.val();

    const questions = app.infoThread
      ? Object.values(app.infoThread).filter(e => e.type === 'question' || e.type === 'addendum')
      : [];

    res.json({
      application: {
        ref: app.ref,
        building: app.building,
        lot: app.lot,
        formLabel: app.formLabel,
        submittedByName: app.submittedByName
      },
      questions,
      token: req.params.token
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SUBMIT APPLICANT RESPONSE ───
router.post('/respond', async (req, res) => {
  try {
    const { token, responseText } = req.body;
    const result = await voting.processApplicantResponse(token, responseText, []);
    res.json(result);
  } catch (err) {
    if (err.message === 'INVALID_TOKEN') return res.status(404).json({ error: 'Invalid link' });
    if (err.message === 'TOKEN_EXPIRED') return res.status(410).json({ error: 'Link expired' });
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: CLEANUP TEST DATA ───
router.post('/admin/cleanup', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    const snap = await db.ref('applications').once('value');
    if (!snap.exists()) return res.json({ deleted: 0 });

    const apps = snap.val();
    let deleted = 0;
    for (const [id, app] of Object.entries(apps)) {
      if (app.status === 'pending_vote' && !app.auditSnapshot) {
        await db.ref(`applications/${id}`).remove();
        deleted++;
      }
    }
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: GET ALL APPLICATIONS ───
router.get('/admin/applications', async (req, res) => {
  try {
    const { password } = req.query;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    const snap = await db.ref('applications').once('value');
    const apps = snap.val() ? Object.values(snap.val()) : [];
    apps.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    res.json(apps);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: GET ALL COMMITTEE MEMBERS ───
router.get('/admin/members', async (req, res) => {
  try {
    const { password } = req.query;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    const snap = await db.ref('committee_members').once('value');
    const members = snap.val() ? Object.values(snap.val()) : [];
    res.json(members);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: ADD COMMITTEE MEMBER ───
router.post('/admin/members', async (req, res) => {
  try {
    const { password, buildingKey, name, memberEmail } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    const memberId = uuidv4();
    const accessToken = uuidv4();
    const building = BUILDINGS[buildingKey];
    if (!building) return res.status(400).json({ error: 'Unknown building' });

    const member = {
      memberId,
      buildingKey,
      buildingName: building.name,
      name,
      email: memberEmail,
      accessToken,
      tokenCreatedAt: new Date().toISOString(),
      active: true,
      addedAt: new Date().toISOString(),
      removedAt: null
    };

    await db.ref(`committee_members/${memberId}`).set(member);
    await email.sendWelcomeEmail(member, building);

    res.json({ success: true, memberId, accessToken });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: REMOVE COMMITTEE MEMBER ───
router.post('/admin/members/:memberId/remove', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    await db.ref(`committee_members/${req.params.memberId}`).update({
      active: false,
      removedAt: new Date().toISOString(),
      accessToken: null
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: REGENERATE TOKEN ───
router.post('/admin/members/:memberId/regenerate-token', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });

    const newToken = uuidv4();
    const mSnap = await db.ref(`committee_members/${req.params.memberId}`).once('value');
    if (!mSnap.exists()) return res.status(404).json({ error: 'Member not found' });

    const member = mSnap.val();
    await db.ref(`committee_members/${req.params.memberId}`).update({
      accessToken: newToken,
      tokenCreatedAt: new Date().toISOString()
    });

    const building = BUILDINGS[member.buildingKey];
    await email.sendTokenRegenerated({ ...member, accessToken: newToken }, building);

    res.json({ success: true, newToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;