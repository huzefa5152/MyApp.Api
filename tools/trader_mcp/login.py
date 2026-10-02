"""Interactive local sign-in; password is never saved or exposed as an MCP tool."""
import argparse
import base64
import ctypes
from ctypes import wintypes
import getpass
import json
import os
from pathlib import Path

import httpx


def protect(data: bytes, decrypt=False) -> bytes:
    if os.name != "nt":
        raise ValueError("Encrypted profiles currently require Windows. On other systems use token environment variables.")
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError("Could not access the encrypted credential for this Windows user.")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


def read_profile(path: Path) -> dict:
    profile = json.loads(path.read_text(encoding="utf-8"))
    if "token" in profile:
        raise ValueError("Plaintext tokens are not accepted in profile files.")
    profile["token"] = protect(base64.b64decode(profile.pop("protectedToken")), decrypt=True).decode()
    return profile


def main():
    from server import validate_url
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    profile = json.loads(args.config.read_text(encoding="utf-8"))
    origin = validate_url(profile["apiBaseUrl"])
    username = input("Trader username: ")
    password = getpass.getpass("Trader password: ")
    try:
        with httpx.Client(timeout=20, trust_env=False, follow_redirects=False) as client:
            response = client.post(origin + "/api/auth/login", json={"username": username, "password": password})
            if response.status_code != 200:
                raise ValueError("Trader sign-in failed. Check your credentials and account status.")
            token = response.json().get("token")
            if not token:
                raise ValueError("Trader did not return a session token.")
    except httpx.HTTPError:
        raise ValueError("Trader sign-in could not reach the configured server.") from None
    finally:
        password = ""
    profile.pop("token", None)
    profile["protectedToken"] = base64.b64encode(protect(token.encode())).decode()
    args.config.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print("Signed in. Session encrypted for this Windows account; no password saved. Restart the MCP connection.")


if __name__ == "__main__":
    main()
