require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ROUTES ───
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// ─── PORTAL PAGE ───
app.get('/portal/:accessToken', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// ─── APPLICANT RESPONSE PAGE ───
app.get('/respond/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'respond.html'));
});

// ─── ADMIN PAGE ───
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── MAIN APP ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`My Building Portal v2 running on port ${PORT}`);

  // Seed committee members if needed
  try {
    const { seedCommitteeMembers } = require('./config/committees');
    await seedCommitteeMembers();
  } catch (err) {
    console.error('Seed error:', err.message);
  }

  // Start cron jobs
  try {
    const { startCronJobs } = require('./services/cron');
    startCronJobs();
  } catch (err) {
    console.error('Cron start error:', err.message);
  }
});