"""全仓路径常量唯一出处。

目录分类约定：
- 资产目录（随仓库提交，Agent 高频读写）：flows/ extracts/ heal_templates/ learnings/
- 运行时数据（gitignore，可随时清理重建）：data/ 下的 logs/ output/ backups/ 与 webadmin.db
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# 资产目录
FLOWS_DIR = REPO_ROOT / "flows"
EXTRACTS_DIR = REPO_ROOT / "extracts"
HEAL_TEMPLATES_DIR = REPO_ROOT / "heal_templates"
LEARNINGS_DIR = REPO_ROOT / "learnings"

# 用户级配置
CONFIG_PATH = REPO_ROOT / "config.json"

# 运行时数据
DATA_DIR = REPO_ROOT / "data"
LOGS_DIR = DATA_DIR / "logs"
HEAL_LOGS_DIR = LOGS_DIR / "heals"
OUTPUT_DIR = DATA_DIR / "output"
FLOW_BACKUPS_DIR = DATA_DIR / "backups" / "flows"
WEBADMIN_DB = DATA_DIR / "webadmin.db"
