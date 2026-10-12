"""Filesystem locations and immutable application settings."""

import os
import shutil
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = APP_ROOT / "frontend"
PAGES_DIR = FRONTEND_DIR / "pages"
ASSETS_DIR = FRONTEND_DIR / "assets"
RESOURCE_DIR = APP_ROOT / "resources"
GENERAL_RESOURCES = RESOURCE_DIR / "general"
AGRICULTURAL_RESOURCES = RESOURCE_DIR / "agricultural"
TEMPLATE = GENERAL_RESOURCES / "master_template.docx"
AGRICULTURAL_TEMPLATE = AGRICULTURAL_RESOURCES / "master_template.docx"
AGRICULTURAL_SCHEMA = AGRICULTURAL_RESOURCES / "form_schema.json"
AGRICULTURAL_MAPPING = AGRICULTURAL_RESOURCES / "template_mapping.json"
SCHEMA = GENERAL_RESOURCES / "form_schema.json"
OUTPUT_DIR = APP_ROOT / "outputs" / "generated_reports"
SOFFICE = os.environ.get("SOFFICE_PATH") or shutil.which("soffice") or "/usr/bin/soffice"
DEFAULT_VALUER_NAME_ADDRESS = "K.Sivaprasad,B.E.,M.I.E.,F.I.V.\nH.No:21-2/16A1,SKD Colony Adoni."
DEFAULT_VALUER_NAME = "K.Sivaprasad"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}

def qn(name):
    return f"{{{W}}}{name}"
