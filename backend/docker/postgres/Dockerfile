FROM postgres:17-bookworm

# pg_bigm — 한국어 2-gram 전문검색 (PRD §6.8)
# 관리형 Postgres 대부분이 확장 허용목록에 없어 자체 호스팅을 택한 이유 중 하나다 (§17).
# PGDG에 패키지가 없으므로 소스에서 빌드한다.
ARG PG_BIGM_VERSION=1.2-20240606

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        postgresql-server-dev-17; \
    curl -fsSL -o /tmp/pg_bigm.tar.gz \
        "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz"; \
    mkdir -p /tmp/pg_bigm; \
    tar -xzf /tmp/pg_bigm.tar.gz -C /tmp/pg_bigm --strip-components=1; \
    cd /tmp/pg_bigm; \
    make USE_PGXS=1 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config; \
    make USE_PGXS=1 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config install; \
    cd /; \
    rm -rf /tmp/pg_bigm /tmp/pg_bigm.tar.gz; \
    apt-get purge -y --auto-remove build-essential postgresql-server-dev-17 curl; \
    rm -rf /var/lib/apt/lists/*

# pg_bigm은 shared_preload_libraries가 필요 없다. CREATE EXTENSION으로 충분하다.
