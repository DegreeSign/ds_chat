#!/bin/bash

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Optional llama.cpp install
# curl -LsSf https://llama.app/install.sh | sh

# Model
MODEL_BASE="unsloth/Qwen3-VL-2B-Instruct-GGUF:Q3_K_M"
CONTEXT_LENGTH=160000
# HF_TOKEN="hf_..." # Optional Hugging Face token

# Detect GPU VRAM, informational only
if command -v rocm-smi &>/dev/null; then
  VRAM_MB=$(rocm-smi --showmeminfo vram 2>/dev/null | grep "Total Memory" | head -1 | awk '{print int($NF)}')
  [ -n "$VRAM_MB" ] && [ "$VRAM_MB" -gt 0 ] && echo "GPU VRAM: ${VRAM_MB}MB"
elif [ -f /sys/class/drm/card0/device/mem_info_vram_total ]; then
  VRAM_BYTES=$(cat /sys/class/drm/card0/device/mem_info_vram_total 2>/dev/null)
  VRAM_MB=$(( VRAM_BYTES / 1024 / 1024 ))
  [ -n "$VRAM_MB" ] && [ "$VRAM_MB" -gt 0 ] && echo "GPU VRAM: ${VRAM_MB}MB"
elif command -v nvidia-smi &>/dev/null; then
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
  [ -n "$VRAM_MB" ] && [ "$VRAM_MB" -gt 0 ] && echo "GPU VRAM: ${VRAM_MB}MB"
fi

# Run
  llama serve -c $CONTEXT_LENGTH \
    -hf $MODEL_BASE \
    --host 127.0.0.1 \
    --port 8080 \
    --threads 4 \
    --tools "all" \
    --models-autoload \
    --cache-reuse 256 \
    -ub 1024 \
    -ngl 0 \
    --webui-mcp-proxy
