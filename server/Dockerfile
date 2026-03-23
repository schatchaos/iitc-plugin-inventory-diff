FROM perl:5.38-slim

WORKDIR /app

RUN cpanm --notest \
    Mojolicious \
    Mojo::Redis \
    IO::Socket::SSL

COPY inventory-diff-server.pl .

ENV INVDIFF_PORT=3000
ENV INVDIFF_REDIS_URL=redis://redis:6379
ENV INVDIFF_CORS_ORIGIN=https://intel.ingress.com
ENV INVDIFF_MAX_SNAPSHOTS=50
ENV INVDIFF_TLS_CERT=
ENV INVDIFF_TLS_KEY=

EXPOSE ${INVDIFF_PORT}

CMD ["sh", "-c", "\
  if [ -n \"$INVDIFF_TLS_CERT\" ] && [ -n \"$INVDIFF_TLS_KEY\" ]; then \
    exec perl inventory-diff-server.pl daemon -l \"https://*:${INVDIFF_PORT}?cert=${INVDIFF_TLS_CERT}&key=${INVDIFF_TLS_KEY}\"; \
  else \
    exec perl inventory-diff-server.pl daemon -l \"http://*:${INVDIFF_PORT}\"; \
  fi"]
