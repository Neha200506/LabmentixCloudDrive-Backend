const express = require("express");
const cors = require("cors");
const session = require("express-session");
require("dotenv").config();

const pool = require("./database/db");
const authRoutes = require("./routes/authRoutes");
const fileRoutes = require("./routes/fileRoutes");
const folderRoutes = require("./routes/folderRoutes");
const shareRoutes = require("./routes/shareRoutes");
const authMiddleware = require("./middleware/authMiddleware");
const passport = require("./config/passport");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Session middleware
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Authentication routes
app.use("/api/auth", authRoutes);

// File routes
app.use("/api/files", fileRoutes);

// Folder routes
app.use("/api/folders", folderRoutes);

// Share routes
app.use("/api/share", shareRoutes);

// Home route
app.get("/", (req, res) => {
  res.send("Labmentix Cloud Drive Backend is Running 🚀");
});

// Protected route
app.get("/api/profile", authMiddleware, (req, res) => {
  res.json({
    message: "Protected route accessed successfully",
    user: req.user,
  });
});

// Test database connection only when not running tests
if (process.env.NODE_ENV !== "test") {
  pool
    .query("SELECT NOW()")
    .then(() => console.log("Supabase PostgreSQL Connected Successfully"))
    .catch((err) =>
      console.error("Database Connection Error:", err.message)
    );

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;