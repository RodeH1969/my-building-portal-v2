require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./firebase-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
}

const db = admin.database();
const storage = admin.storage();

module.exports = { admin, db, storage };