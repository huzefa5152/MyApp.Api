"""Sync the Vite assets folder (admin/assets) by file NAME.

Every file Vite writes there carries a content hash in its name, so a name the
server already has is already the right bytes. That lets a deploy:

  upload  - add the new files while the site is still live. Nothing is removed,
            so the pages already open keep loading their own chunks.
  prune   - after the new index.html is live, delete the files this release no
            longer references. An open page that then misses an old chunk is
            reloaded onto the new version (utils/serviceContinuity.js).

Usage: python3 ftp_assets.py upload|prune <local assets dir>
Env:   FTP_SERVER, FTP_USERNAME, FTP_PASSWORD
"""
import ftplib
import os
import sys

REMOTE_DIR = "/wwwroot/wwwroot/admin/assets"


def remote_names(ftp):
    try:
        return {os.path.basename(n) for n in ftp.nlst()}
    except ftplib.error_perm:
        return set()  # empty directory answers 550 on some servers


def main():
    mode, local_dir = sys.argv[1], sys.argv[2]
    local = {n for n in os.listdir(local_dir) if os.path.isfile(os.path.join(local_dir, n))}
    if not local:
        sys.exit(f"No files in {local_dir} - refusing to sync an empty assets folder.")

    with ftplib.FTP(os.environ["FTP_SERVER"], timeout=60) as ftp:
        ftp.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
        try:
            ftp.cwd(REMOTE_DIR)
        except ftplib.error_perm:
            ftp.mkd(REMOTE_DIR)
            ftp.cwd(REMOTE_DIR)
        server = remote_names(ftp) - {".", ".."}

        if mode == "upload":
            todo = sorted(local - server)
            for name in todo:
                with open(os.path.join(local_dir, name), "rb") as f:
                    ftp.storbinary(f"STOR {name}", f)
            print(f"Uploaded {len(todo)} new asset(s); {len(local) - len(todo)} already on the server.")
        elif mode == "prune":
            todo = sorted(server - local)
            # The site is already live on the new release here, so a file that
            # will not delete is a warning, not a failed deploy.
            for name in todo:
                try:
                    ftp.delete(name)
                except ftplib.all_errors as e:
                    print(f"::warning::Could not delete {name}: {e}")
            print(f"Removed superseded assets ({len(todo)} not in this release).")
        else:
            sys.exit(f"Unknown mode {mode!r}")


if __name__ == "__main__":
    main()
