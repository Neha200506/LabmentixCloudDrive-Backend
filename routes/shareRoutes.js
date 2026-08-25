const express = require("express");

const {
  createShare,
  accessShare,
} = require("../controllers/shareController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Create shareable link
router.post(
  "/",
  authMiddleware,
  createShare
);

// Access shared file using share token
router.get(
  "/:token",
  accessShare
);

module.exports = router;