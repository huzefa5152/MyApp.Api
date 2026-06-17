// src/utils/fileIcons.js
// Maps a file name / extension to a react-icon component + brand colour, and
// a couple of helpers for sizing and preview-ability. Shared by the
// attachment component, the preview modal, and folder views.
import {
  MdPictureAsPdf,
  MdImage,
  MdDescription,
  MdSlideshow,
  MdTableChart,
  MdFolderZip,
  MdArticle,
  MdInsertDriveFile,
} from "react-icons/md";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"];

function extOf(nameOrExt = "") {
  const s = String(nameOrExt).toLowerCase().trim();
  if (!s) return "";
  if (s.startsWith(".")) return s;
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot) : "";
}

// Returns { Icon, color } — Icon is a react-icons component (render as <Icon/>).
export function fileIconFor(nameOrExt = "") {
  const ext = extOf(nameOrExt);
  if (IMAGE_EXTS.includes(ext)) return { Icon: MdImage, color: "#00897b" };
  if (ext === ".pdf") return { Icon: MdPictureAsPdf, color: "#d32f2f" };
  if (ext === ".doc" || ext === ".docx") return { Icon: MdDescription, color: "#1565c0" };
  if (ext === ".xls" || ext === ".xlsx" || ext === ".csv") return { Icon: MdTableChart, color: "#2e7d32" };
  if (ext === ".ppt" || ext === ".pptx") return { Icon: MdSlideshow, color: "#e64a19" };
  if (ext === ".zip") return { Icon: MdFolderZip, color: "#6a1b9a" };
  if (ext === ".txt") return { Icon: MdArticle, color: "#5f6d7e" };
  return { Icon: MdInsertDriveFile, color: "#5f6d7e" };
}

export const isImageExt = (ext = "") => IMAGE_EXTS.includes(extOf(ext));
export const isPdfExt = (ext = "") => extOf(ext) === ".pdf";

export function humanSize(bytes = 0) {
  const b = Number(bytes) || 0;
  if (b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
