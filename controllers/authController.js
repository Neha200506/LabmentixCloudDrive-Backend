const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const pool = require("../database/db");

// Nodemailer helper function
const sendResetEmail = async (recipientEmail, resetUrl) => {
  const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Nexora Drive" <no-reply@nexoradrive.com>`,
    to: recipientEmail,
    subject: "Reset Your Nexora Drive Password",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">Password Reset Request</h2>
        <p>You requested a password reset for your Nexora Drive account.</p>
        <p>Click the button below to set a new password for your account:</p>
        <div style="margin: 25px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 12px; color: #64748b;">If you didn't request a password reset, you can safely ignore this email. This link will expire in 1 hour.</p>
      </div>
    `,
  };

  try {
    await mailTransporter.sendMail(mailOptions);
  } catch (err) {
    console.warn("Nodemailer reset email warning:", err.message);
  }
};

const signup = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3) RETURNING id, full_name, email",
      [full_name, email, hashedPassword],
    );

    res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "User not found" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const logout = (req, res) => {
  res.json({
    message: "Logout successful. Please remove the token from the client.",
  });
};

// Request Password Reset
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await pool.query(
      `SELECT * FROM public.users WHERE LOWER(email) = LOWER($1)`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.json({
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString("hex");

    await pool.query(
      `UPDATE public.users
       SET recovery_token = $1, recovery_sent_at = NOW()
       WHERE id = $2`,
      [resetToken, user.id]
    );

    const frontendBaseUrl = process.env.FRONTEND_URL || `http://localhost:5173`;
    const resetUrl = `${frontendBaseUrl}/reset-password?token=${resetToken}`;

    await sendResetEmail(cleanEmail, resetUrl);

    res.json({
      message: "If an account with that email exists, a password reset link has been sent.",
      reset_token: resetToken,
      reset_url: resetUrl,
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reset Password with Token
const resetPassword = async (req, res) => {
  try {
    const { token, new_password, password } = req.body;
    const newPassword = new_password || password;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Reset token and new password are required" });
    }

    // Verify token exists and was sent within the last 1 hour
    const result = await pool.query(
      `SELECT * FROM public.users 
       WHERE recovery_token = $1 
       AND recovery_sent_at > NOW() - INTERVAL '1 hour'`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired password reset token" });
    }

    const user = result.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE public.users
       SET password = $1, recovery_token = NULL, recovery_sent_at = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.json({
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, full_name, email FROM users WHERE email NOT LIKE '%@example.com' ORDER BY full_name ASC"
    );

    res.json({
      users: result.rows,
    });
  } catch (error) {
    console.error("Get Users Error:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

module.exports = { signup, login, logout, forgotPassword, resetPassword, getUsers };

