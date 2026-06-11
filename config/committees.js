// Committee member seed data for all 6 buildings
// Fake names and emails for testing
// In production these are managed via the admin panel

const { db } = require('./firebase');
const { v4: uuidv4 } = require('uuid');

const BUILDINGS = {
  NT: { name: 'Newstead Towers', address: '88 Doggett St / 37 Kyabra St, Newstead QLD 4006', size: 5 },
  FT: { name: 'Festival Towers', address: '108 Albert St, Brisbane City QLD 4000', size: 5 },
  NC: { name: 'Newstead Central', address: '24 Stratton St / 1055 Ann St, Newstead QLD 4006', size: 7 },
  SP: { name: 'The Spire', address: '550 Queen St, Brisbane City QLD 4000', size: 3 },
  NS: { name: 'Newstead Series', address: 'Newstead QLD 4006', size: 4 },
  BA: { name: 'Broadway on Ann', address: 'Ann St, Fortitude Valley QLD 4006', size: 5 }
};

const MAJORITY = { 3: 2, 4: 3, 5: 3, 6: 4, 7: 4 };

const SEED_MEMBERS = {
  NT: [
    { name: 'Sarah Mitchell', email: 'airbrandr@gmail.com' },
    { name: 'James Kowalski', email: 'airbrandr@gmail.com' },
    { name: 'Priya Sharma', email: 'airbrandr@gmail.com' },
    { name: 'David Chen', email: 'airbrandr@gmail.com' },
    { name: 'Lisa Okafor', email: 'airbrandr@gmail.com' }
  ],
  FT: [
    { name: 'Michael Torres', email: 'airbrandr@gmail.com' },
    { name: 'Angela Nguyen', email: 'airbrandr@gmail.com' },
    { name: 'Robert Singh', email: 'airbrandr@gmail.com' },
    { name: 'Claire Dubois', email: 'airbrandr@gmail.com' },
    { name: 'Tony Papadopoulos', email: 'airbrandr@gmail.com' }
  ],
  NC: [
    { name: 'Helen Park', email: 'airbrandr@gmail.com' },
    { name: 'Steve Lawson', email: 'airbrandr@gmail.com' },
    { name: 'Maria Costa', email: 'airbrandr@gmail.com' },
    { name: 'Ben Fitzgerald', email: 'airbrandr@gmail.com' },
    { name: 'Amy Zhou', email: 'airbrandr@gmail.com' },
    { name: 'Paul Henderson', email: 'airbrandr@gmail.com' },
    { name: 'Susan Baker', email: 'airbrandr@gmail.com' }
  ],
  SP: [
    { name: 'Nathan Reed', email: 'airbrandr@gmail.com' },
    { name: 'Karen Walsh', email: 'airbrandr@gmail.com' },
    { name: 'Frank Moretti', email: 'airbrandr@gmail.com' }
  ],
  NS: [
    { name: 'Olivia Grant', email: 'airbrandr@gmail.com' },
    { name: 'Chris Yamamoto', email: 'airbrandr@gmail.com' },
    { name: 'Debra Nkosi', email: 'airbrandr@gmail.com' },
    { name: 'Mark Sullivan', email: 'airbrandr@gmail.com' }
  ],
  BA: [
    { name: 'Rachel Tran', email: 'airbrandr@gmail.com' },
    { name: 'Ian Fletcher', email: 'airbrandr@gmail.com' },
    { name: 'Monica Patel', email: 'airbrandr@gmail.com' },
    { name: 'Gary Whitfield', email: 'airbrandr@gmail.com' },
    { name: 'Julia Andersen', email: 'airbrandr@gmail.com' }
  ]
};

async function seedCommitteeMembers() {
  console.log('Seeding committee members...');

  for (const [buildingKey, members] of Object.entries(SEED_MEMBERS)) {
    // Check if already seeded
    const existing = await db.ref(`committee_members`).orderByChild('buildingKey').equalTo(buildingKey).once('value');
    if (existing.exists()) {
      console.log(`${buildingKey} already has members, skipping`);
      continue;
    }

    for (const member of members) {
      const memberId = uuidv4();
      const accessToken = uuidv4();
      await db.ref(`committee_members/${memberId}`).set({
        memberId,
        buildingKey,
        buildingName: BUILDINGS[buildingKey].name,
        name: member.name,
        email: member.email,
        accessToken,
        tokenCreatedAt: new Date().toISOString(),
        active: true,
        addedAt: new Date().toISOString(),
        removedAt: null
      });
      console.log(`Added ${member.name} to ${buildingKey} — portal: /portal/${accessToken}`);
    }
  }

  console.log('Seeding complete.');
}

module.exports = { BUILDINGS, MAJORITY, seedCommitteeMembers };