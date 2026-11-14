# Supply an inspected immutable Node 22 Debian image digest. No credentials or source baked in.
ARG BASE_IMAGE=node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
FROM ${BASE_IMAGE}
LABEL org.opencontainers.image.title="Foliage Evaluation Runtime"
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["node"]
