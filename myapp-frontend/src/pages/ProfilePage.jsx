import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
  MdDelete,
  MdCloudUpload,
  MdSmartToy, MdPalette } from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { updateProfile, changePassword, uploadAvatar, removeAvatar } from "../api/authApi";
import { getAvatarUrl } from "../utils/avatarUrl";
import ThemePicker from "../ui2/ThemePicker";
import McpMyAccessPanel from "../Components/McpMyAccessPanel";
import { PageHeader, Tabs, Card, Button, Field, Alert } from "../ui/Kit";
import McpCatalogAccessPanel from "../Components/McpCatalogAccessPanel";
import McpAgentsPanel from "../Components/McpAgentsPanel";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  cyan: "#00e5ff",
};

// Success / error banner used by every card on the page.
function Msg({ msg }) {
  if (!msg) return null;
  return (
    <Alert tone={msg.type === "success" ? "success" : "error"} icon={msg.type === "success" ? MdCheckCircle : undefined}>
      {msg.text}
    </Alert>
  );
}

// Client-side mirror of the server validation (Helpers/ImageUploadValidator.cs):
// extension allowlist + 7 MB cap. The server is the source of truth — these
// guards just save the user a round-trip on the easy rejections.
const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_BYTES = 7 * 1024 * 1024;

function validateImage(file) {
  if (!file) return "No file selected.";
  const name = (file.name || "").toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));
  if (!ALLOWED_EXTS.includes(ext)) {
    return `Unsupported format. Use ${ALLOWED_EXTS.join(", ")}.`;
  }
  if (file.size > MAX_BYTES) {
    return `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max allowed is 7 MB.`;
  }
  return null;
}

export default function ProfilePage() {
  const { user, refreshUser, setToken, avatarVersion } = useAuth();
  const { has } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAdministerMcp = user?.isSeedAdmin === true && has("mcp.admin.manage");
  const rawTargetUserId = searchParams.get("userId");
  const parsedTargetUserId = Number(rawTargetUserId);
  const targetUserId = /^[1-9]\d*$/.test(rawTargetUserId || "") && Number.isSafeInteger(parsedTargetUserId)
    ? parsedTargetUserId : undefined;
  const requestedTab = searchParams.get("tab");
  const tab = requestedTab === "mcp" ? "mcp-connections"
    : ["mcp-catalog", "mcp-connections", "appearance"].includes(requestedTab) ? requestedTab
    : requestedTab === "mcp-admin" && canAdministerMcp ? "mcp-admin" : "profile";
  const setTab = (nextTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    if (nextTab !== "mcp-catalog") next.delete("userId");
    setSearchParams(next);
  };
  const tabs = [["profile", "Profile", MdAccountCircle], ["appearance", "Appearance", MdPalette], ["mcp-catalog", "MCP Catalog Access", MdSmartToy],
    ["mcp-connections", "MCP Connections", MdSmartToy],
    ...(canAdministerMcp ? [["mcp-admin", "MCP Administration", MdShield]] : [])];
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
  const avatarMsgTimer = useRef(null);
  // Preview-before-save: when the user picks (or drops) a file we hold the
  // File + an object-URL preview. Upload only fires when the user clicks
  // Save — Cancel discards. This matches "modern SaaS" behaviour and lets
  // operators sanity-check the framing before committing.
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const showAvatarMsg = useCallback((msg) => {
    clearTimeout(avatarMsgTimer.current);
    setAvatarMsg(msg);
    avatarMsgTimer.current = setTimeout(() => setAvatarMsg(null), 5000);
  }, []);

  useEffect(() => {
    return () => clearTimeout(avatarMsgTimer.current);
  }, []);

  // Release the object URL whenever the preview changes or unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  const handlePickClick = () => fileRef.current?.click();

  const stageFile = useCallback((file) => {
    const err = validateImage(file);
    if (err) {
      showAvatarMsg({ type: "error", text: err });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setAvatarMsg(null);
  }, [previewUrl, showAvatarMsg]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) stageFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) stageFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleCancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPendingFile(null);
    setAvatarMsg(null);
  };

  const handleSaveAvatar = async () => {
    if (!pendingFile) return;
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      await uploadAvatar(pendingFile);
      // Clear preview *before* refresh so the rendered avatar flips back to
      // the server URL (now cache-busted via avatarVersion) on the same tick.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPendingFile(null);
      await refreshUser();
      showAvatarMsg({ type: "success", text: "Avatar updated" });
    } catch (err) {
      showAvatarMsg({
        type: "error",
        text: err.response?.data?.message || "Failed to upload avatar",
      });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarLoading(true);
    setAvatarMsg(null);
    try {
      await removeAvatar();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPendingFile(null);
      await refreshUser();
      showAvatarMsg({ type: "success", text: "Avatar removed" });
    } catch {
      showAvatarMsg({ type: "error", text: "Failed to remove avatar" });
    } finally {
      setAvatarLoading(false);
    }
  };

  const [avatarHover, setAvatarHover] = useState(false);

  const initials = (user?.fullName || user?.username || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

  // Source of truth for what to render in the avatar circle:
  //   1. live preview (user just picked/dropped a file but hasn't saved)
  //   2. server avatar with cache-buster
  //   3. initials fallback
  const serverAvatarSrc = getAvatarUrl(user, avatarVersion);
  const displayedSrc = previewUrl || serverAvatarSrc;
  const showInitials = !displayedSrc;
  const hasServerAvatar = !!user?.avatarPath && !previewUrl;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <PageHeader
        icon={MdAccountCircle}
        tone="brand"
        title="My Profile"
        subtitle="Manage your account settings"
      />

      <Tabs
        label="Profile sections"
        idPrefix="profile-tab"
        value={tab}
        onChange={setTab}
        tabs={tabs.map(([key, label, icon]) => ({ key, label, icon }))}
      />
      {tab === "mcp-catalog" ? (
        <div role="tabpanel" id="profile-tab-panel-mcp-catalog" aria-labelledby="profile-tab-mcp-catalog"><McpCatalogAccessPanel targetUserId={targetUserId} /></div>
      ) : tab === "mcp-connections" ? (
        <div role="tabpanel" id="profile-tab-panel-mcp-connections" aria-labelledby="profile-tab-mcp-connections"><McpMyAccessPanel /></div>
      ) : tab === "mcp-admin" && canAdministerMcp ? (
        <div role="tabpanel" id="profile-tab-panel-mcp-admin" aria-labelledby="profile-tab-mcp-admin"><McpAgentsPanel /></div>
      ) : tab === "appearance" ? (
        <Card role="tabpanel" id="profile-tab-panel-appearance" aria-labelledby="profile-tab-appearance" title="Interface theme" icon={MdPalette}>
          <p style={{ color: "var(--k-muted)", fontSize: "var(--k-font-sm)", margin: "0 0 0.9rem" }}>
            Changes how screens look, not what they do. Saved for your account on this browser, so other users keep their own choice.
          </p>
          <div className="u2" style={{ maxWidth: 420 }}><ThemePicker /></div>
        </Card>
      ) : (
      <div role="tabpanel" id="profile-tab-panel-profile" aria-labelledby="profile-tab-profile">

      {/* Avatar + Info Card */}
      <div className="k-card" style={styles.profileCard}>
        <div style={styles.profileBanner} />

        {/* Avatar with drag-and-drop zone wrapping the circle */}
        <div style={styles.avatarRow}>
          <div
            style={{
              ...styles.avatarWrapper,
              outline: dragOver ? `3px dashed ${colors.cyan}` : "none",
              outlineOffset: dragOver ? 4 : 0,
            }}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            title="Click, or drag an image here"
          >
            {showInitials ? (
              <div style={styles.avatarFallback}>{initials}</div>
            ) : (
              <img src={displayedSrc} alt="Avatar" style={styles.avatarImg} />
            )}
            {/* Hover overlay — hidden while uploading or when a preview is staged */}
            {!avatarLoading && !previewUrl && (
              <div style={{ ...styles.avatarOverlay, opacity: avatarHover ? 1 : 0 }}>
                {hasServerAvatar ? (
                  <div style={styles.avatarOverlayActions}>
                    <button
                      type="button"
                      onClick={handlePickClick}
                      style={styles.avatarOverlayBtn}
                      title="Change photo"
                    >
                      <MdCameraAlt size={18} />
                      <span style={styles.avatarOverlayLabel}>Change</span>
                    </button>
                    <div style={styles.avatarOverlayDivider} />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}
                      disabled={avatarLoading}
                      style={styles.avatarOverlayBtn}
                      title="Remove photo"
                    >
                      <MdDelete size={18} />
                      <span style={styles.avatarOverlayLabel}>Remove</span>
                    </button>
                  </div>
                ) : (
                  <div onClick={handlePickClick} style={{ cursor: "pointer", textAlign: "center" }}>
                    <MdCameraAlt size={24} color="#fff" />
                  </div>
                )}
              </div>
            )}
            {avatarLoading && <div style={styles.avatarSpinner} />}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>

        <div style={styles.profileInfo}>
          <h3 style={styles.profileName}>{user?.fullName || "User"}</h3>
          <p style={styles.profileUsername}>@{user?.username}</p>
          <span style={styles.roleBadge}>
            <MdShield size={13} style={{ marginRight: 4 }} />
            {user?.role || "User"}
          </span>
        </div>

        {avatarMsg && (
          <div style={{ padding: "0 1.5rem", marginTop: "0.75rem" }}>
            <Msg msg={avatarMsg} />
          </div>
        )}

        {/* Avatar actions: preview-staged → Save / Cancel; otherwise → Upload */}
        <div style={styles.avatarActions}>
          {previewUrl ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveAvatar}
                disabled={avatarLoading}
              >
                {avatarLoading ? <span className="btn-spinner" /> : <MdCloudUpload size={16} />}
                {avatarLoading ? "Uploading..." : "Save Photo"}
              </Button>
              <Button
                size="sm"
                icon={MdClose}
                onClick={handleCancelPreview}
                disabled={avatarLoading}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" icon={MdCameraAlt} onClick={handlePickClick} disabled={avatarLoading}>
              {hasServerAvatar ? "Change Photo" : "Upload Photo"}
            </Button>
          )}
        </div>
        <p style={styles.avatarHint}>
          {previewUrl
            ? "Preview shown above. Click Save Photo to upload, or Cancel to discard."
            : "JPG, PNG or WebP. Max 7 MB. You can also drag an image onto the avatar."}
        </p>
      </div>

      {/* Profile Details Card */}
      <Card
        title="Profile Details"
        icon={MdPerson}
        tone="blue"
        actions={(
          <Button
            variant={editing ? "secondary" : "primary"}
            size="sm"
            icon={editing ? MdClose : MdEdit}
            onClick={handleEditToggle}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      >
        <Msg msg={profileMsg} />

        <form onSubmit={handleProfileSave} style={styles.form}>
          <Field label={<><MdBadge size={14} style={styles.labelIcon} />Username</>}>
            {editing ? (
              <input
                className="k-input"
                value={profileForm.username}
                onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
              />
            ) : (
              <p style={styles.value}>{user?.username}</p>
            )}
          </Field>
          <Field label={<><MdPerson size={14} style={styles.labelIcon} />Full Name</>}>
            {editing ? (
              <input
                className="k-input"
                value={profileForm.fullName}
                onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
              />
            ) : (
              <p style={styles.value}>{user?.fullName}</p>
            )}
          </Field>
          {editing && (
            <div style={styles.formActions}>
              <Button
                type="submit"
                variant="primary"
                icon={MdSave}
                disabled={profileLoading}
              >
                {profileLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </form>
      </Card>

      {/* Change Password Card */}
      <Card title="Change Password" icon={MdLock} tone="teal">
        <Msg msg={pwMsg} />

        <form onSubmit={handlePasswordChange} style={styles.form}>
          <Field label="Current Password">
            <input
              type="password"
              className="k-input"
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
              placeholder="Enter current password"
            />
          </Field>
          <Field label="New Password">
            <input
              type="password"
              className="k-input"
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              placeholder="At least 6 characters"
            />
          </Field>
          <Field label="Confirm New Password">
            <input
              type="password"
              className="k-input"
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              placeholder="Re-enter new password"
            />
          </Field>
          <div style={styles.formActions}>
            <Button
              type="submit"
              variant="teal"
              icon={MdLock}
              disabled={pwLoading}
            >
              {pwLoading ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </form>
      </Card>
      </div>
      )}
    </div>
  );
}

const styles = {
  profileCard: {
    overflow: "hidden",
  },
  profileBanner: {
    height: 90,
    background: `linear-gradient(135deg, ${colors.blue} 0%, ${colors.teal} 100%)`,
  },
  avatarRow: {
    display: "flex",
    justifyContent: "center",
    marginTop: -52,
  },
  avatarWrapper: {
    position: "relative",
    width: 104,
    height: 104,
    borderRadius: "50%",
    cursor: "pointer",
    flexShrink: 0,
    overflow: "hidden",
    border: "4px solid #fff",
    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
    transition: "transform 0.25s",
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
    fontSize: "2.2rem",
    fontWeight: 700,
    letterSpacing: 1,
  },
  avatarOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transition: "opacity 0.25s",
    borderRadius: "50%",
  },
  avatarOverlayActions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 0,
  },
  avatarOverlayBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    padding: "6px 10px",
  },
  avatarOverlayLabel: {
    fontSize: "0.65rem",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  },
  avatarOverlayDivider: {
    height: 1,
    width: 40,
    background: "rgba(255,255,255,0.35)",
  },
  avatarSpinner: {
    position: "absolute",
    inset: 0,
    border: "3px solid transparent",
    borderTopColor: colors.cyan,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  profileInfo: {
    textAlign: "center",
    padding: "0.75rem 1.5rem 0",
  },
  profileName: {
    margin: 0,
    fontSize: "1.35rem",
    fontWeight: 700,
    color: "var(--k-ink)",
    overflowWrap: "anywhere",
  },
  profileUsername: {
    margin: "0.2rem 0 0",
    color: "var(--k-muted)",
    fontSize: "0.9rem",
    overflowWrap: "anywhere",
  },
  roleBadge: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "0.5rem",
    padding: "0.25rem 0.75rem",
    borderRadius: 20,
    background: `linear-gradient(135deg, ${colors.blue}18, ${colors.teal}18)`,
    color: colors.blue,
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  avatarActions: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "0.6rem",
    padding: "1rem 1.5rem 0",
    flexWrap: "wrap",
  },
  avatarHint: {
    textAlign: "center",
    color: "var(--k-muted)",
    fontSize: "0.78rem",
    margin: 0,
    padding: "0.6rem 1.5rem 1.25rem",
  },
  form: { display: "flex", flexDirection: "column", gap: "1rem" },
  formActions: { display: "flex", justifyContent: "flex-end" },
  labelIcon: { marginRight: 4, verticalAlign: "-2px" },
  value: {
    margin: 0,
    fontSize: "var(--k-font)",
    color: "var(--k-ink)",
    padding: "0.35rem 0",
    overflowWrap: "anywhere",
  },
};
