const express = require("express");
const passport = require("passport");
const router = express.Router();

const { signup, login, logout, forgotPassword, resetPassword, getUsers } = require("../controllers/authController");

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/users", getUsers);

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
