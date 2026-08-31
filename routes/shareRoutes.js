const express = require("express");

const {
  createShare,
  accessShare,
  shareFileWithUser,
  listFileSharedUsers,
  updateUserPermission,
  removeUserPermission,
} = require("../controllers/shareController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Create public shareable link
router.post(
  "/",
  authMiddleware,
  createShare
);

// Access shared file using public share token (unauthenticated)
router.get(
  "/:token",
  accessShare
);

// Share a file with registered user by email
router.post(
  "/file",
  authMiddleware,
  shareFileWithUser
);

// List users who have access to a file
router.get(
  "/file/:file_id/users",
  authMiddleware,
  listFileSharedUsers
);

// Update a user's permission type for a file
router.put(
  "/file/:file_id/permission",
  authMiddleware,
  updateUserPermission
);

// Remove a user's permission for a file using user_id in URL path
router.delete(
  "/file/:file_id/permission/:user_id",
  authMiddleware,
  removeUserPermission
);

// Remove a user's permission for a file using payload (email/user_id in query or body)
router.delete(
  "/file/:file_id/permission",
  authMiddleware,
  removeUserPermission
);

module.exports = router;