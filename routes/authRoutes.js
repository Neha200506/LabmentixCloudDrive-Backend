const express = require("express");
const passport = require("passport");
const router = express.Router();

const { signup, login, logout } = require("../controllers/authController");

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);

// Google OAuth - Start Login
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
);

// Google OAuth - Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/",
  }),
  (req, res) => {
    res.send("Google Login Successful ✅");
  },
);

module.exports = router;
