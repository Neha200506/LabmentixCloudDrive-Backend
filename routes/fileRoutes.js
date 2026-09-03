const express = require("express");

const upload = require("../middleware/uploadMiddleware");

const {
  uploadFile,
  getFiles,
  getFileUrl,
  renameFile,
  deleteFile,
  getTrash,
  restoreFile,
  searchFiles,
  toggleStarFile,
  deleteFilePermanent,
  updateFileContent,
  getPdfText,
  getFileVersions,
  getFileVersionUrl,
  restoreFileVersion,
} = require("../controllers/fileController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Upload a file
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  uploadFile
);

// Search user's files
router.get(
  "/search",
  authMiddleware,
  searchFiles
);

// Get user's active files
router.get(
  "/",
  authMiddleware,
  getFiles
);

// Get trash
router.get(
  "/trash",
  authMiddleware,
  getTrash
);

// Restore file from trash
router.put(
  "/:id/restore",
  authMiddleware,
  restoreFile
);

// Get all historical versions for a file
router.get(
  "/:id/versions",
  authMiddleware,
  getFileVersions
);

// Get download URL for a specific historical version
router.get(
  "/:id/versions/:version_id/url",
  authMiddleware,
  getFileVersionUrl
);

// Restore a historical version as active file
router.post(
  "/:id/versions/:version_id/restore",
  authMiddleware,
  restoreFileVersion
);

// Get download URL
router.get(
  "/:id/url",
  authMiddleware,
  getFileUrl
);

// Get extracted PDF text
router.get(
  "/:id/pdf-text",
  authMiddleware,
  getPdfText
);

// Update file content
router.put(
  "/:id/content",
  authMiddleware,
  updateFileContent
);

// Rename file
router.put(
  "/:id",
  authMiddleware,
  renameFile
);

// Move file to trash
router.delete(
  "/:id",
  authMiddleware,
  deleteFile
);

// Toggle star status of file
router.put(
  "/:id/star",
  authMiddleware,
  toggleStarFile
);

// Permanent delete file
router.delete(
  "/:id/permanent",
  authMiddleware,
  deleteFilePermanent
);

module.exports = router;