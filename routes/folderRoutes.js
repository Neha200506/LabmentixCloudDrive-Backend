const express = require("express");

const {
  createFolder,
  getFolders,
  renameFolder,
  deleteFolder,
  getFolderTrash,
  restoreFolder,
  toggleStarFolder,
  deleteFolderPermanent,
} = require("../controllers/folderController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Create folder
router.post(
  "/",
  authMiddleware,
  createFolder
);

// Get user's active folders
router.get(
  "/",
  authMiddleware,
  getFolders
);

// Get folder trash
router.get(
  "/trash",
  authMiddleware,
  getFolderTrash
);

// Restore folder from trash
router.put(
  "/:id/restore",
  authMiddleware,
  restoreFolder
);

// Rename folder
router.put(
  "/:id",
  authMiddleware,
  renameFolder
);

// Move folder to trash
router.delete(
  "/:id",
  authMiddleware,
  deleteFolder
);

// Toggle star status of folder
router.put(
  "/:id/star",
  authMiddleware,
  toggleStarFolder
);

// Permanent delete folder
router.delete(
  "/:id/permanent",
  authMiddleware,
  deleteFolderPermanent
);

module.exports = router;