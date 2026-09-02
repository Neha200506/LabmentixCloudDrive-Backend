const pool = require("../database/db");
const supabase = require("../config/supabase");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { getBackendBaseUrl } = require("../utils/network");

// Create nodemailer transporter configured through env variables
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587/other
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

// Helper function to send sharing emails
const sendSharingEmail = async (recipientEmail, fileName, permissionType, shareUrl) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || `"Nexora Drive" <no-reply@nexoradrive.com>`,
    to: recipientEmail,
    subject: `File Shared with you: ${fileName}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">File Shared with You</h2>
        <p>A file has been shared with you on Nexora Drive:</p>
        <table style="border-collapse: collapse; margin: 20px 0; width: 100%;">
          <tr>
            <td style="padding: 6px 15px 6px 0; font-weight: bold; width: 120px;">File Name:</td>
            <td style="padding: 6px 0; color: #1e293b;">${fileName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 15px 6px 0; font-weight: bold;">Permission:</td>
            <td style="padding: 6px 0; color: #1e293b;">${permissionType}</td>
          </tr>
        </table>
        <p>You can access the file by clicking the link below:</p>
        <div style="margin: 25px 0;">
          <a href="${shareUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Shared File
          </a>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 25px 0;" />
        <p style="font-size: 11px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
          If the button above does not work, copy and paste the following URL into your browser address bar: <br/>
          <a href="${shareUrl}" style="color: #4f46e5; word-break: break-all;">${shareUrl}</a>
        </p>
      </div>
    `,
  };

  // Graceful fallback if SMTP settings are not provided in environment variables
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("---------------- SMTP NOT CONFIGURING PLACEHOLDER LOG ----------------");
    console.log(`To: ${recipientEmail}`);
    console.log(`Subject: ${mailOptions.subject}`);
    console.log(`Share Link: ${shareUrl}`);
    console.log("----------------------------------------------------------------------");
    return { success: true, logged: true };
  }

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log("Sharing email sent successfully:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Failed to send sharing email:", error);
    throw error;
  }
};

// Create shareable link
const createShare = async (req, res) => {
  try {
    const { file_id, role } = req.body;
    const ownerId = req.user.id;

    if (!file_id) {
      return res.status(400).json({
        message: "File ID is required",
      });
    }

    const allowedRoles = ["view", "edit", "owner"];

    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role",
      });
    }

    // Check that the file belongs to the logged-in user
    const fileResult = await pool.query(
      `SELECT *
       FROM files
       WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found",
      });
    }

    const shareToken = crypto.randomBytes(32).toString("hex");

    const result = await pool.query(
      `INSERT INTO file_shares
       (file_id, owner_id, share_token, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [file_id, ownerId, shareToken, role || "view"]
    );

    const backendBaseUrl = getBackendBaseUrl();

    res.status(201).json({
      message: "Share link created successfully",
      share: result.rows[0],
      share_url: `${backendBaseUrl}/api/share/${shareToken}`,
    });
  } catch (error) {
    console.error("Create Share Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Access shared file
const accessShare = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT
         file_shares.*,
         files.file_name,
         files.file_type,
         files.storage_path
       FROM file_shares
       JOIN files ON file_shares.file_id = files.id
       WHERE file_shares.share_token = $1
       AND files.deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Share link not found or file is unavailable",
      });
    }

    const share = result.rows[0];

    const { data, error } = await supabase.storage
      .from("files")
      .createSignedUrl(share.storage_path, 3600);

    if (error) {
      return res.status(500).json({
        message: "Could not create secure file URL",
        error: error.message,
      });
    }

    // If client explicitly requests JSON, or passes ?json=true, return JSON response
    const acceptHeader = req.headers.accept || "";
    if (req.query.json === "true" || acceptHeader.includes("application/json")) {
      return res.json({
        message: "Shared file accessed successfully",
        file: {
          name: share.file_name,
          type: share.file_type,
          role: share.role,
          url: data.signedUrl,
        },
      });
    }

    // Otherwise, redirect the browser to the Supabase signed URL
    return res.redirect(data.signedUrl);
  } catch (error) {
    console.error("Access Share Error:", error);

    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Share a FILE with another registered or unregistered user by email
const shareFileWithUser = async (req, res) => {
  try {
    const { file_id, email, permission_type, role } = req.body;
    const ownerId = req.user.id;

    if (!file_id || !email) {
      return res.status(400).json({
        message: "File ID and user email are required",
      });
    }

    let permissionType = permission_type || role;
    if (permissionType) {
      if (permissionType.toLowerCase() === "viewer") permissionType = "Viewer";
      if (permissionType.toLowerCase() === "editor") permissionType = "Editor";
    }

    const allowedPermissions = ["Viewer", "Editor"];
    if (!permissionType || !allowedPermissions.includes(permissionType)) {
      return res.status(400).json({
        message: "Invalid permission type. Must be 'Viewer' or 'Editor'",
      });
    }

    // Verify the file belongs to the logged-in user
    const fileResult = await pool.query(
      `SELECT *
       FROM files
       WHERE id = $1
       AND user_id = $2
       AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    const fileName = fileResult.rows[0].file_name;
    const normPerm = (permissionType || "").toLowerCase();
    const dbPermissionType = (normPerm === "viewer" || normPerm === "view") ? "view" : "edit";
    const cleanEmail = email.trim().toLowerCase();

    // Find the target user in the users table
    const userResult = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
      [cleanEmail]
    );

    let isRegistered = false;
    let permissionRecord = null;

    if (userResult.rows.length > 0) {
      const targetUserId = userResult.rows[0].id;
      isRegistered = true;

      // Prevent sharing with oneself
      if (targetUserId === ownerId) {
        return res.status(400).json({
          message: "You cannot share a file with yourself",
        });
      }

      // Check duplicate in permissions
      const duplicatePerm = await pool.query(
        `SELECT * FROM permissions WHERE file_id = $1 AND shared_with = $2`,
        [file_id, targetUserId]
      );
      if (duplicatePerm.rows.length > 0) {
        return res.status(400).json({
          message: "File is already shared with this user",
        });
      }
    }

    // Check duplicate in file_shares
    const duplicateShare = await pool.query(
      `SELECT * FROM file_shares WHERE file_id = $1 AND share_token LIKE $2`,
      [file_id, `email:${cleanEmail}:%`]
    );
    if (duplicateShare.rows.length > 0) {
      return res.status(400).json({
        message: "File is already shared with this email",
      });
    }

    // If registered, insert permission record
    if (isRegistered) {
      const targetUserId = userResult.rows[0].id;
      const permResult = await pool.query(
        `INSERT INTO permissions
         (file_id, owner_id, shared_with, permission_type)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [file_id, ownerId, targetUserId, dbPermissionType]
      );
      permissionRecord = permResult.rows[0];
    }

    // Generate prefixed email share token for the link (for BOTH registered and unregistered)
    const shareToken = `email:${cleanEmail}:${crypto.randomBytes(16).toString("hex")}`;
    const shareResult = await pool.query(
      `INSERT INTO file_shares
       (file_id, owner_id, share_token, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [file_id, ownerId, shareToken, dbPermissionType]
    );

    // Formulate the clickable share URL
    const backendBaseUrl = getBackendBaseUrl();
    const shareUrl = `${backendBaseUrl}/api/share/${shareToken}`;

    // Send email notification
    await sendSharingEmail(email, fileName, permissionType, shareUrl);

    res.status(201).json({
      message: "File shared successfully",
      registered: isRegistered,
      permission: permissionRecord ? {
        ...permissionRecord,
        permission_type: permissionType
      } : null,
      share: shareResult.rows[0],
      share_url: shareUrl
    });
  } catch (error) {
    console.error("Share File With User Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// List users who have access to a file
const listFileSharedUsers = async (req, res) => {
  try {
    const { file_id } = req.params;
    const ownerId = req.user.id;

    // Verify ownership of the file
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    // Fetch registered users details from permissions
    const result = await pool.query(
      `SELECT
         users.id,
         users.full_name,
         users.email,
         permissions.permission_type
       FROM permissions
       JOIN users ON permissions.shared_with = users.id
       WHERE permissions.file_id = $1`,
      [file_id]
    );

    const registeredUsers = result.rows.map(user => {
      let displayPermission = user.permission_type;
      if (user.permission_type === "view") displayPermission = "Viewer";
      if (user.permission_type === "edit") displayPermission = "Editor";
      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        permission_type: displayPermission,
        status: "registered"
      };
    });

    const registeredEmails = new Set(registeredUsers.map(u => u.email.toLowerCase()));

    // Fetch unregistered users details from file_shares where token starts with 'email:'
    const unregSharesResult = await pool.query(
      `SELECT id, share_token, role
       FROM file_shares
       WHERE file_id = $1 AND share_token LIKE 'email:%'`,
      [file_id]
    );

    const unregisteredUsers = [];
    for (const share of unregSharesResult.rows) {
      const parts = share.share_token.split(':');
      const email = parts[1] || '';
      if (!registeredEmails.has(email.toLowerCase())) {
        const displayPermission = share.role === "edit" ? "Editor" : "Viewer";
        unregisteredUsers.push({
          id: share.id, // Using the file_shares record ID
          full_name: "Unregistered User",
          email: email,
          permission_type: displayPermission,
          status: "unregistered"
        });
      }
    }

    res.json({
      message: "Shared users retrieved successfully",
      users: [...registeredUsers, ...unregisteredUsers],
    });
  } catch (error) {
    console.error("List Shared Users Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Update an existing user's permission
const updateUserPermission = async (req, res) => {
  try {
    const { file_id } = req.params;
    const { user_id, permission_type, role } = req.body;
    const ownerId = req.user.id;

    // Verify ownership of the file
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    let permissionType = permission_type || role;
    if (permissionType) {
      if (permissionType.toLowerCase() === "viewer") permissionType = "Viewer";
      if (permissionType.toLowerCase() === "editor") permissionType = "Editor";
    }

    const allowedPermissions = ["Viewer", "Editor"];
    if (!permissionType || !allowedPermissions.includes(permissionType)) {
      return res.status(400).json({
        message: "Invalid permission type. Must be 'Viewer' or 'Editor'",
      });
    }

    const normPerm = (permissionType || "").toLowerCase();
    const dbPermissionType = (normPerm === "viewer" || normPerm === "view") ? "view" : "edit";

    // Check if the user_id exists in the users table
    const userCheck = await pool.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [user_id]
    );

    let updatedRecord = null;

    if (userCheck.rows.length > 0) {
      const userEmail = userCheck.rows[0].email;

      // 1. Registered User: update permissions table
      const result = await pool.query(
        `UPDATE permissions
         SET permission_type = $1
         WHERE file_id = $2
         AND shared_with = $3
         RETURNING *`,
        [dbPermissionType, file_id, user_id]
      );
      if (result.rows.length > 0) {
        updatedRecord = {
          ...result.rows[0],
          permission_type: permissionType
        };
      }

      // Also update role in file_shares by email token
      await pool.query(
        `UPDATE file_shares
         SET role = $1
         WHERE file_id = $2
         AND share_token LIKE $3`,
        [dbPermissionType, file_id, `email:${userEmail.trim().toLowerCase()}:%`]
      );
    } else {
      // 2. Unregistered User: the user_id passed is the file_shares record id!
      const result = await pool.query(
        `UPDATE file_shares
         SET role = $1
         WHERE file_id = $2
         AND id = $3
         RETURNING *`,
        [dbPermissionType, file_id, user_id]
      );
      if (result.rows.length > 0) {
        updatedRecord = {
          ...result.rows[0],
          permission_type: permissionType
        };
      }
    }

    if (!updatedRecord) {
      return res.status(404).json({
        message: "Permission or shared link not found to update",
      });
    }

    res.json({
      message: "Permission updated successfully",
      permission: updatedRecord,
    });
  } catch (error) {
    console.error("Update User Permission Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Remove a user's permission
const removeUserPermission = async (req, res) => {
  try {
    const { file_id, user_id } = req.params;
    const ownerId = req.user.id;

    // Verify ownership of the file
    const fileResult = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [file_id, ownerId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        message: "File not found or access denied",
      });
    }

    // Check if the user_id exists in the users table first
    const userCheck = await pool.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [user_id]
    );

    let deletedCount = 0;

    if (userCheck.rows.length > 0) {
      const userEmail = userCheck.rows[0].email;

      // 1. Registered User: delete from permissions
      const deletePermResult = await pool.query(
        `DELETE FROM permissions
         WHERE file_id = $1
         AND shared_with = $2
         RETURNING *`,
        [file_id, user_id]
      );
      if (deletePermResult.rows.length > 0) {
        deletedCount++;
      }

      // Also delete from file_shares by email token
      await pool.query(
        `DELETE FROM file_shares
         WHERE file_id = $1
         AND share_token LIKE $2`,
        [file_id, `email:${userEmail.trim().toLowerCase()}:%`]
      );
    } else {
      // 2. Unregistered User: the user_id passed is the file_shares record id!
      const deleteShareResult = await pool.query(
        `DELETE FROM file_shares
         WHERE file_id = $1
         AND id = $2
         RETURNING *`,
        [file_id, user_id]
      );
      if (deleteShareResult.rows.length > 0) {
        deletedCount++;
      }
    }

    if (deletedCount === 0) {
      return res.status(404).json({
        message: "Permission or shared link not found",
      });
    }

    res.json({
      message: "Permission removed successfully",
    });
  } catch (error) {
    console.error("Remove User Permission Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  createShare,
  accessShare,
  shareFileWithUser,
  listFileSharedUsers,
  updateUserPermission,
  removeUserPermission,
};