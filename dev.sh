#!/usr/bin/env bash
# 紫鸟自动化引擎 — 开发启动脚本
# 启动 webadmin 后端 (9482) + 前端 dev server (5173)
# 再次运行会自动结束已在跑的旧服务

set -euo pipefail
cd "$(dirname "$0")"

BE_PORT=9482
FE_PORT=5173

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[0;33m'; CYN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GRN}[启动]${NC} $*"; }
warn() { echo -e "${YEL}[提示]${NC} $*"; }

# ── 清理旧进程 ──────────────────────────────────────────
kill_port() {
    local port=$1 name=$2
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        warn "$name 端口 $port 被占用 (PID $pids)，正在结束..."
        kill $pids 2>/dev/null || true
        sleep 0.5
        # 若仍未退出则强杀
        kill -9 $pids 2>/dev/null || true
    fi
}

kill_port $BE_PORT "后端"
kill_port $FE_PORT "前端"

# ── 依赖检查 ─────────────────────────────────────────────
if [[ ! -x .venv/bin/python3 ]]; then
    echo -e "${RED}[错误]${NC} 未找到 .venv，请先创建虚拟环境："
    echo "  python3 -m venv .venv && .venv/bin/pip install -r webadmin/requirements.txt"
    exit 1
fi

if [[ ! -d webadmin/frontend/node_modules ]]; then
    echo -e "${RED}[错误]${NC} 前端依赖缺失，请先安装："
    echo "  cd webadmin/frontend && npm install"
    exit 1
fi

# ── 启动服务 ─────────────────────────────────────────────
log "启动后端 → http://127.0.0.1:$BE_PORT"
.venv/bin/python3 -m webadmin &
BE_PID=$!

log "启动前端 → http://localhost:$FE_PORT"
(cd webadmin/frontend && npm run dev) &
FE_PID=$!

# ── Ctrl+C 优雅退出 ──────────────────────────────────────
cleanup() {
    echo
    log "正在停止服务..."
    kill $BE_PID 2>/dev/null || true
    kill $FE_PID 2>/dev/null || true
    wait $BE_PID $FE_PID 2>/dev/null || true
    log "已停止"
    exit 0
}
trap cleanup INT TERM

echo -e "${CYN}─────────────────────────────────────────${NC}"
echo -e "  后端 API : ${CYN}http://127.0.0.1:$BE_PORT${NC}"
echo -e "  前端 Dev : ${CYN}http://localhost:$FE_PORT${NC}"
echo -e "  按 ${YEL}Ctrl+C${NC} 停止所有服务"
echo -e "${CYN}─────────────────────────────────────────${NC}"

wait
