const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pool = require("../database/db");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:8080/api/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const fullName = profile.displayName;
        const profilePicture = profile.photos?.[0]?.value || null;

        const existingUser = await pool.query(
          "SELECT * FROM users WHERE email = $1",
          [email],
        );

        if (existingUser.rows.length > 0) {
          return done(null, existingUser.rows[0]);
        }

        const result = await pool.query(
          `INSERT INTO users (full_name, email, profile_picture)
           VALUES ($1, $2, $3)
           RETURNING id, full_name, email, profile_picture`,
          [fullName, email, profilePicture],
        );

        return done(null, result.rows[0]);
      } catch (error) {
        return done(error, null);
      }
    },
  ),
);

module.exports = passport;
