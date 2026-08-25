const express = require("express");

const {
  createFolder,
  getFolders,
  renameFolder,
  deleteFolder,
  getFolderTrash,
  restoreFolder,
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

module.exports = router;