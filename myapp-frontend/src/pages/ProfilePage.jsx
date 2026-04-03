import { useState, useRef } from "react";
import {
  MdAccountCircle,
  MdEdit,
  MdSave,
  MdClose,
  MdLock,
  MdPerson,
  MdBadge,
  MdCameraAlt,
  MdCheckCircle,
  MdShield,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { updateProfile, changePassword, uploadAvatar } from "../api/authApi";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  cyan: "#00e5ff",
  cardBg: "#ffffff",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#eafbef",
};

export default function ProfilePage() {
  const { user, refreshUser, setToken } = useAuth();
  const fileRef = useRef(null);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({
    username: user?.username ?? "",
    fullName: user?.fullName ?? "",
  });
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Change password state
  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Avatar state
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState(null);

  const handleEditToggle = () => {
    if (editing) {
      setProfileForm({
        username: user?.username ?? "",
        fullName: user?.fullName ?? "",
      });
    }
    setEditing(!editing);
    setProfileMsg(null);
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    if (!profileForm.username.trim() || !profileForm.fullName.trim()) {
      setProfileMsg({ type: "error", text: "Username and Full Name are required" });
      return;
    }
    setProfileLoading(true);
    setProfileMsg(null);
    try {
      const res = await updateProfile(profileForm);
      // Update token if username changed
      if (res.data.token) {
        localStorage.setItem("token", res.data.token);
        setToken(res.data.token);
      }
      await refreshUser();
      setEditing(false);
      setProfileMsg({ type: "success", text: "Profile updated successfully" });
    } catch (err) {
      setProfileMsg({
        type: "error",
        text: err.response?.data?.message || "Failed to update profile",
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!pwForm.currentPassword || !pwForm.newPassword) {
      setPwMsg({ type: "error", text: "All fields are required" });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      setPwMsg({ type: "error", text: "New password must be at least 6 characters" });
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwMsg({ type: "error", text: "New passwords do not match" });
      return;
    }
    setPwLoading(true);
    setPwMsg(null);
    try {
      await changePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPwMsg({ type: "success", text: "Password changed successfully" });
    } catch (err) {
      setPwMsg({
        type: "error",
        text: err.response?.data?.message || "Failed to change password",
      });
    } finally {
      setPwLoading(false);
    }
  };

  const handleAvatarClick = () => fileRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      await uploadAvatar(file);
      await refreshUser();
      setAvatarMsg({ type: "success", text: "Avatar updated" });
    } catch (err) {
      setAvatarMsg({
        type: "error",
        text: err.response?.data?.message || "Failed to upload avatar",
      });
    } finally {
      setAvatarLoading(false);
      e.target.value = "";
    }
  };

  const [avatarHover, setAvatarHover] = useState(false);

  const initials = (user?.fullName || user?.username || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Page header */}
      <div style={styles.pageHeader}>
        <div style={styles.headerIcon}>
          <MdAccountCircle size={28} color="#fff" />
        </div>
        <div>
          <h2 style={styles.pageTitle}>My Profile</h2>
          <p style={styles.pageSubtitle}>Manage your account settings</p>
        </div>
      </div>

      {/* Avatar + Info Card */}
      <div style={styles.card}>
        <div style={styles.avatarSection}>
          <div
            style={styles.avatarWrapper}
            onClick={handleAvatarClick}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
          >
            {user?.avatarPath ? (
              <img
                src={user.avatarPath}
                alt="Avatar"
                style={styles.avatarImg}
              />
            ) : (
              <div style={styles.avatarFallback}>{initials}</div>
            )}
            <div style={{ ...styles.avatarOverlay, opacity: avatarHover ? 1 : 0 }}>
              <MdCameraAlt size={22} color="#fff" />
            </div>
            {avatarLoading && <div style={styles.avatarSpinner} />}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, color: colors.textPrimary, fontSize: "1.3rem" }}>
              {user?.fullName || "User"}
            </h3>
            <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary, fontSize: "0.9rem" }}>
              @{user?.username}
            </p>
            <span style={styles.roleBadge}>
              <MdShield size={13} style={{ marginRight: 4 }} />
              {user?.role || "User"}
            </span>
          </div>
        </div>
        {avatarMsg && (
          <div style={avatarMsg.type === "success" ? styles.successMsg : styles.errorMsg}>
            {avatarMsg.text}
          </div>
        )}
        <p style={{ color: colors.textSecondary, fontSize: "0.82rem", margin: "0.75rem 0 0", textAlign: "center" }}>
          Click avatar to upload a new photo (JPG, PNG, WebP — max 2 MB)
        </p>
      </div>

      {/* Profile Details Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MdPerson size={20} color={colors.blue} />
            <h3 style={styles.cardTitle}>Profile Details</h3>
          </div>
          <button
            type="button"
            style={editing ? styles.cancelBtn : styles.editBtn}
            onClick={handleEditToggle}
          >
            {editing ? <><MdClose size={16} /> Cancel</> : <><MdEdit size={16} /> Edit</>}
          </button>
        </div>

        {profileMsg && (
          <div style={profileMsg.type === "success" ? styles.successMsg : styles.errorMsg}>
            {profileMsg.type === "success" && <MdCheckCircle size={16} style={{ marginRight: 6 }} />}
            {profileMsg.text}
          </div>
        )}

        <form onSubmit={handleProfileSave}>
          <div style={styles.formRow}>
            <label style={styles.label}>
              <MdBadge size={14} style={{ marginRight: 4, color: colors.textSecondary }} />
              Username
            </label>
            {editing ? (
              <input
                style={styles.input}
                value={profileForm.username}
                onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
              />
            ) : (
              <p style={styles.value}>{user?.username}</p>
            )}
          </div>
          <div style={styles.formRow}>
            <label style={styles.label}>
              <MdPerson size={14} style={{ marginRight: 4, color: colors.textSecondary }} />
              Full Name
            </label>
            {editing ? (
              <input
                style={styles.input}
                value={profileForm.fullName}
                onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
              />
            ) : (
              <p style={styles.value}>{user?.fullName}</p>
            )}
          </div>
          {editing && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="submit"
                style={styles.saveBtn}
                disabled={profileLoading}
              >
                <MdSave size={16} />
                {profileLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Change Password Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MdLock size={20} color={colors.teal} />
            <h3 style={styles.cardTitle}>Change Password</h3>
          </div>
        </div>

        {pwMsg && (
          <div style={pwMsg.type === "success" ? styles.successMsg : styles.errorMsg}>
            {pwMsg.type === "success" && <MdCheckCircle size={16} style={{ marginRight: 6 }} />}
            {pwMsg.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange}>
          <div style={styles.formRow}>
            <label style={styles.label}>Current Password</label>
            <input
              type="password"
              style={styles.input}
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
              placeholder="Enter current password"
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.label}>New Password</label>
            <input
              type="password"
              style={styles.input}
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              placeholder="At least 6 characters"
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.label}>Confirm New Password</label>
            <input
              type="password"
              style={styles.input}
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              placeholder="Re-enter new password"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button
              type="submit"
              style={{ ...styles.saveBtn, background: `linear-gradient(135deg, ${colors.teal}, #00695c)` }}
              disabled={pwLoading}
            >
              <MdLock size={16} />
              {pwLoading ? "Changing..." : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  pageHeader: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pageTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  pageSubtitle: {
    margin: "0.15rem 0 0",
    fontSize: "0.88rem",
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: 14,
    border: `1px solid ${colors.cardBorder}`,
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    padding: "1.5rem",
    marginBottom: "1.25rem",
  },
  avatarSection: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    flexWrap: "wrap",
  },
  avatarWrapper: {
    position: "relative",
    width: 100,
    height: 100,
    borderRadius: "50%",
    cursor: "pointer",
    flexShrink: 0,
    overflow: "hidden",
    border: `3px solid ${colors.cardBorder}`,
    transition: "border-color 0.25s",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  avatarFallback: {
    width: "100%",
    height: "100%",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize: "2rem",
    fontWeight: 700,
    letterSpacing: 1,
  },
  avatarOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transition: "opacity 0.25s",
    borderRadius: "50%",
  },
  avatarSpinner: {
    position: "absolute",
    inset: 0,
    border: "3px solid transparent",
    borderTopColor: colors.cyan,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  roleBadge: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "0.5rem",
    padding: "0.2rem 0.7rem",
    borderRadius: 20,
    background: `linear-gradient(135deg, ${colors.blue}18, ${colors.teal}18)`,
    color: colors.blue,
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1.25rem",
    paddingBottom: "0.75rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
  cardTitle: {
    margin: 0,
    fontSize: "1.05rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  editBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "0.4rem 0.9rem",
    borderRadius: 8,
    border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.blueLight})`,
    color: "#fff",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s",
  },
  cancelBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "0.4rem 0.9rem",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#e9ecf1",
    color: colors.textSecondary,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s",
  },
  saveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0.5rem 1.25rem",
    borderRadius: 8,
    border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.blueLight})`,
    color: "#fff",
    fontSize: "0.88rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s",
  },
  formRow: {
    marginBottom: "1rem",
  },
  label: {
    display: "flex",
    alignItems: "center",
    marginBottom: "0.3rem",
    fontWeight: 600,
    fontSize: "0.83rem",
    color: colors.textSecondary,
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.85rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    fontSize: "0.95rem",
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    outline: "none",
    transition: "border-color 0.25s, box-shadow 0.25s",
    boxSizing: "border-box",
  },
  value: {
    margin: 0,
    fontSize: "0.95rem",
    color: colors.textPrimary,
    padding: "0.6rem 0",
  },
  successMsg: {
    display: "flex",
    alignItems: "center",
    backgroundColor: colors.successLight,
    color: colors.success,
    padding: "0.65rem 1rem",
    borderRadius: 8,
    marginBottom: "1rem",
    fontWeight: 500,
    border: `1px solid ${colors.success}30`,
    fontSize: "0.85rem",
  },
  errorMsg: {
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    padding: "0.65rem 1rem",
    borderRadius: 8,
    marginBottom: "1rem",
    fontWeight: 500,
    border: `1px solid ${colors.danger}30`,
    fontSize: "0.85rem",
  },
};
