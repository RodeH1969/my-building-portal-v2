const multer = require('multer');
const path = require('path');
const { storage } = require('../config/firebase');

// ─── MULTER — memory storage, 10MB per file, max 10 files ───
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mp3'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${ext}`));
    }
  }
});

// ─── UPLOAD FILES TO FIREBASE STORAGE ───
// Returns array of { fieldName, originalName, url, contentType, size }
async function uploadFilesToStorage(files, applicationId) {
  if (!files || files.length === 0) return [];

  const bucket = storage.bucket();
  const results = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `applications/${applicationId}/${Date.now()}_${safeName}`;

    const fileRef = bucket.file(storagePath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        metadata: {
          applicationId,
          fieldName: file.fieldname,
          originalName: file.originalname
        }
      }
    });

    // Make publicly readable
    await fileRef.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    results.push({
      fieldName: file.fieldname,
      originalName: file.originalname,
      url,
      contentType: file.mimetype,
      size: file.size
    });

    console.log(`Uploaded: ${file.originalname} → ${url}`);
  }

  return results;
}

module.exports = { upload, uploadFilesToStorage };