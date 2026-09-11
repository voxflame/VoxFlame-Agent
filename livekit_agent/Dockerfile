ARG LIVEKIT_AGENT_BASE_IMAGE=docker.m.daocloud.io/library/python:3.10-slim
FROM ${LIVEKIT_AGENT_BASE_IMAGE}

ARG LIVEKIT_AGENT_BOOTSTRAP_DEPS=1
ARG LIVEKIT_AGENT_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG LIVEKIT_AGENT_PIP_EXTRA_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

WORKDIR /app

RUN if [ "$LIVEKIT_AGENT_BOOTSTRAP_DEPS" = "1" ]; then \
      pip install --upgrade pip setuptools wheel && \
      pip install \
        --index-url "${LIVEKIT_AGENT_PIP_INDEX_URL}" \
        --extra-index-url "${LIVEKIT_AGENT_PIP_EXTRA_INDEX_URL}" \
        "livekit-agents==1.7.1" \
        "python-dotenv>=1.0,<2.0" ; \
    fi

RUN pip install \
    --index-url "${LIVEKIT_AGENT_PIP_INDEX_URL}" \
    --extra-index-url "${LIVEKIT_AGENT_PIP_EXTRA_INDEX_URL}" \
    --no-deps \
    "websockets>=15.0,<16.0" \
    "httpx>=0.27,<1.0"

COPY *.py /app/
COPY scripts /app/scripts

# Match the fast image payload and reject missing runtime imports at build time.
RUN PYTHON_DOTENV_DISABLED=1 LIVEKIT_URL=ws://127.0.0.1:7880 \
    LIVEKIT_API_KEY=build-check LIVEKIT_API_SECRET=build-check-not-a-real-secret \
    python -c "import app"

CMD ["python", "app.py", "start"]
